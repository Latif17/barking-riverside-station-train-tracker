import { loadConfig } from './config.js';
import { createSupabaseClient } from './supabaseClient.js';
import { fetchAllRowsForDate, upsertScheduledServices } from './repository.js';
import { createTokenProvider } from './rttAuth.js';
import { fetchTodayRows } from './rttClient.js';
import { todayLondon } from './dateHelpers.js';
import { computePeakPeriod, getPollingState } from './peakPeriod.js';
import { getScheduledServicesForDate } from './schedule.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

export async function pollOnce(
  config: ReturnType<typeof loadConfig>,
  client: ReturnType<typeof createSupabaseClient>,
  tokenProvider1: ReturnType<typeof createTokenProvider>,
  tokenProvider2: ReturnType<typeof createTokenProvider>,
) {
  const now = new Date();
  if (getPollingState(now) === 'sleep') {
    return; // Skip polling entirely
  }

  const serviceDate = todayLondon();

  const [bgvRows, bkgRows, dbRows] = await Promise.all([
    fetchTodayRows(config.rttBaseUrl, tokenProvider1, serviceDate, { code: config.rttStationCode }),
    fetchTodayRows(config.rttBaseUrl2, tokenProvider2, serviceDate, { code: config.rttStationCode2, filterTo: config.rttStationCode }),
    fetchAllRowsForDate(client, serviceDate),
  ]);

  const bgvMap = new Map<string, typeof bgvRows[0]>();
  for (const r of bgvRows) {
    const timeMs = new Date(r.scheduled_time).getTime();
    bgvMap.set(`${timeMs}|${r.direction}`, r);
  }

  const bkgMap = new Map<string, typeof bkgRows[0]>();
  for (const r of bkgRows) {
    if (r.rtt_uid && r.direction === 'departing') {
      bkgMap.set(r.rtt_uid, r);
    }
  }

  const dbRowsMap = new Map<string, typeof dbRows[0]>();
  for (const r of dbRows) {
    const timeMs = new Date(r.scheduled_time).getTime();
    dbRowsMap.set(`${timeMs}|${r.direction}`, r);
  }

  const expectedRows = getScheduledServicesForDate(serviceDate);
  const nowMs = Date.now();
  const claimedRttUids = new Set<string>();
  const rowsToUpsert: typeof expectedRows = [];

  for (const row of expectedRows) {
    const timeMs = new Date(row.scheduled_time).getTime();
    const timeSinceScheduled = nowMs - timeMs;
    const WINDOW_MS = 6 * 60 * 1000; // +/- 6 minutes

    const dbRow = dbRowsMap.get(`${timeMs}|${row.direction}`);

    // Find all trains in the RTT feed that fall within the fuzzy window
    const candidates = bgvRows.filter((r) => {
      if (r.direction !== row.direction) return false;
      if (r.rtt_uid && claimedRttUids.has(r.rtt_uid)) return false;
      const rTimeMs = new Date(r.scheduled_time).getTime();
      return Math.abs(rTimeMs - timeMs) <= WINDOW_MS;
    });

    let bgvRow: typeof bgvRows[0] | undefined = undefined;
    
    if (candidates.length > 0) {
      const nonCancelled = candidates.filter((r) => r.status !== 'cancelled');
      const groupToUse = nonCancelled.length > 0 ? nonCancelled : candidates;
      
      bgvRow = groupToUse.reduce((prev, curr) => {
        const prevDiff = Math.abs(new Date(prev.scheduled_time).getTime() - timeMs);
        const currDiff = Math.abs(new Date(curr.scheduled_time).getTime() - timeMs);
        if (currDiff < prevDiff) return curr;
        if (currDiff > prevDiff) return prev;
        return curr; // prefer the latter one if tied
      });
    }

    if (bgvRow && bgvRow.rtt_uid) {
      claimedRttUids.add(bgvRow.rtt_uid);
    }

    const rttUid = bgvRow?.rtt_uid ?? dbRow?.rtt_uid;
    const bkgRow = rttUid ? bkgMap.get(rttUid) : undefined;

    if (bgvRow) {
      row.status = bgvRow.status;
      row.observed_time = bgvRow.observed_time;
      row.rtt_uid = bgvRow.rtt_uid;

      // Adjust delay_minutes to account for the shift from the expected static schedule
      const rttTimeMs = new Date(bgvRow.scheduled_time).getTime();
      const scheduleShiftMinutes = Math.round((rttTimeMs - timeMs) / 60000);
      const rttDelay = bgvRow.delay_minutes ?? 0;
      row.delay_minutes = scheduleShiftMinutes + rttDelay;

      if (row.status === 'pending' && timeSinceScheduled >= 30 * 60 * 1000) {
        row.status = 'cancelled';
      }
    } else if (dbRow) {
      row.status = dbRow.status;
      row.observed_time = dbRow.observed_time;
      row.delay_minutes = dbRow.delay_minutes;
      row.rtt_uid = dbRow.rtt_uid;

      if (row.status === 'pending' && timeSinceScheduled >= 30 * 60 * 1000) {
        row.status = 'cancelled';
      }
    } else {
      row.status = 'cancelled';
      row.rtt_uid = rttUid ?? null;
    }

    if (row.direction === 'arriving') {
      if (bkgRow) {
        row.upstream_status = bkgRow.status;
        row.upstream_observed_time = bkgRow.observed_time;
        row.upstream_delay_minutes = bkgRow.delay_minutes;

        const upstreamTimeSinceScheduled = nowMs - new Date(bkgRow.scheduled_time).getTime();
        if (row.upstream_status === 'pending' && upstreamTimeSinceScheduled >= 30 * 60 * 1000) {
          row.upstream_status = 'cancelled';
        }
      } else if (dbRow?.upstream_status) {
        row.upstream_status = dbRow.upstream_status;
        row.upstream_observed_time = dbRow.upstream_observed_time;
        row.upstream_delay_minutes = dbRow.upstream_delay_minutes;

        if (row.upstream_status === 'pending' && timeSinceScheduled >= 30 * 60 * 1000) {
          row.upstream_status = 'cancelled';
        }
      } else {
        row.upstream_status = 'cancelled';
      }
    }

    let changed = false;
    if (!dbRow) {
      changed = true;
    } else {
      if (
        row.status !== dbRow.status ||
        row.observed_time !== dbRow.observed_time ||
        row.delay_minutes !== dbRow.delay_minutes ||
        row.rtt_uid !== dbRow.rtt_uid ||
        row.upstream_status !== dbRow.upstream_status ||
        row.upstream_observed_time !== dbRow.upstream_observed_time ||
        row.upstream_delay_minutes !== dbRow.upstream_delay_minutes
      ) {
        changed = true;
      }
    }

    if (changed) {
      rowsToUpsert.push(row);
    }
  }

  if (rowsToUpsert.length === 0) return;

  if (DRY_RUN) {
    console.log(`[dry-run] would upsert ${rowsToUpsert.length} rows`);
    return;
  }

  await upsertScheduledServices(client, rowsToUpsert);
  console.log(`Upserted ${rowsToUpsert.length} changed rows`);
}

export function getPollInterval(
  period: ReturnType<typeof getPollingState>,
  config: ReturnType<typeof loadConfig>,
): number {
  if (period === 'am_peak' || period === 'pm_peak') {
    return config.pollIntervalPeakMs;
  }
  if (period === 'sleep') {
    return config.pollIntervalSleepMs;
  }
  return config.pollIntervalOffPeakMs;
}

async function main() {
  const config = loadConfig();
  const client = createSupabaseClient(config);
  const tokenProvider = createTokenProvider({
    baseUrl: config.rttBaseUrl,
    refreshToken: config.rttRefreshToken,
  });

  const tokenProvider2 = createTokenProvider({
    baseUrl: config.rttBaseUrl2,
    refreshToken: config.rttRefreshToken2,
  });

  console.log(`Starting poller (dry run: ${DRY_RUN}, peak interval: ${config.pollIntervalPeakMs}ms, off-peak interval: ${config.pollIntervalOffPeakMs}ms, sleep interval: ${config.pollIntervalSleepMs}ms)`);

  const tick = () => {
    const startTime = Date.now();
    pollOnce(config, client, tokenProvider, tokenProvider2)
      .catch((err) => {
        console.error('Poll cycle failed:', err);
      })
      .finally(() => {
        const now = new Date();
        const period = getPollingState(now);
        const interval = getPollInterval(period, config);

        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, interval - elapsed);

        setTimeout(tick, delay);
      });
  };

  tick();
}

if (process.env.NODE_ENV !== 'test') {
  main();
}

