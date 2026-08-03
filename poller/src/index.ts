// poller/src/index.ts
import { loadConfig } from './config.js';
import { createSupabaseClient } from './supabaseClient.js';
import { fetchAllRowsForDate, fetchPendingRows, upsertScheduledServices, deleteScheduledServices } from './repository.js';
import { createTokenProvider } from './rttAuth.js';
import { fetchTodayRows } from './rttClient.js';
import { applyForceResolveFallback, dedupeRowsByNaturalKey, dedupeByScheduledTime } from './forceResolve.js';
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
    bgvMap.set(`${r.scheduled_time}|${r.direction}`, r);
  }

  const bkgMap = new Map<string, typeof bkgRows[0]>();
  for (const r of bkgRows) {
    if (r.rtt_uid) {
      bkgMap.set(r.rtt_uid, r);
    }
  }

  const dbRowsMap = new Map<string, typeof dbRows[0]>();
  for (const r of dbRows) {
    dbRowsMap.set(`${r.scheduled_time}|${r.direction}`, r);
  }

  const expectedRows = getScheduledServicesForDate(serviceDate);
  const nowMs = Date.now();

  const freshRows = expectedRows.map((row) => {
    const bgvRow = bgvMap.get(`${row.scheduled_time}|${row.direction}`);
    const timeSinceScheduled = nowMs - new Date(row.scheduled_time).getTime();
    
    const rttUid = bgvRow?.rtt_uid ?? dbRowsMap.get(`${row.scheduled_time}|${row.direction}`)?.rtt_uid;
    const bkgRow = rttUid ? bkgMap.get(rttUid) : undefined;

    if (bgvRow) {
      row.status = bgvRow.status;
      row.observed_time = bgvRow.observed_time;
      row.delay_minutes = bgvRow.delay_minutes;
      row.rtt_uid = bgvRow.rtt_uid;

      if (row.status === 'pending' && timeSinceScheduled >= 30 * 60 * 1000) {
        row.status = 'cancelled';
      }
    } else {
      row.status = 'cancelled';
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
      } else {
        row.upstream_status = 'cancelled';
      }
    }

    return row;
  });

  const pendingRows = dbRows.filter((r) => r.status === 'pending');
  const forceResolvedRows = applyForceResolveFallback(pendingRows, freshRows, now);

  const merged = dedupeRowsByNaturalKey([...dbRows, ...forceResolvedRows, ...freshRows]);

  const { keep: rowsToUpsert, drop: rowsToDelete } = dedupeByScheduledTime(merged);

  if (rowsToUpsert.length === 0 && rowsToDelete.length === 0) return;

  const uidsToDelete = rowsToDelete.map((r) => r.rtt_uid).filter((uid): uid is string => uid !== null);

  if (DRY_RUN) {
    console.log(`[dry-run] would upsert ${rowsToUpsert.length} rows:`, rowsToUpsert);
    console.log(`[dry-run] would delete ${uidsToDelete.length} rows:`, uidsToDelete);
    return;
  }

  await deleteScheduledServices(client, serviceDate, uidsToDelete);
  await upsertScheduledServices(client, rowsToUpsert);
  console.log(`Upserted ${rowsToUpsert.length} rows, Deleted ${uidsToDelete.length} obsolete rows`);
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

