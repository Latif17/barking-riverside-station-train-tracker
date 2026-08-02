// poller/src/index.ts
import { loadConfig } from './config.js';
import { createSupabaseClient } from './supabaseClient.js';
import { fetchAllRowsForDate, fetchPendingRows, upsertScheduledServices, deleteScheduledServices } from './repository.js';
import { createTokenProvider } from './rttAuth.js';
import { fetchTodayRows } from './rttClient.js';
import { applyForceResolveFallback, dedupeRowsByNaturalKey, dedupeByScheduledTime } from './forceResolve.js';
import { todayLondon } from './dateHelpers.js';
import { computePeakPeriod } from './peakPeriod.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

export async function pollOnce(
  config: ReturnType<typeof loadConfig>,
  client: ReturnType<typeof createSupabaseClient>,
  tokenProvider: ReturnType<typeof createTokenProvider>,
) {
  const now = new Date();
  if (computePeakPeriod(now) === 'sleep') {
    return; // Skip polling entirely
  }

  const serviceDate = todayLondon();

  const [freshRows, dbRows] = await Promise.all([
    fetchTodayRows(config, tokenProvider, serviceDate),
    fetchAllRowsForDate(client, serviceDate),
  ]);

  const pendingRows = dbRows.filter((r) => r.status === 'pending');
  const forceResolvedRows = applyForceResolveFallback(pendingRows, freshRows, now);

  const merged = dedupeRowsByNaturalKey([...dbRows, ...forceResolvedRows, ...freshRows]);

  const { keep: rowsToUpsert, drop: rowsToDelete } = dedupeByScheduledTime(merged);

  if (rowsToUpsert.length === 0 && rowsToDelete.length === 0) return;

  const uidsToDelete = rowsToDelete.map((r) => r.rtt_uid);

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
  period: ReturnType<typeof computePeakPeriod>,
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

  console.log(`Starting poller (dry run: ${DRY_RUN}, peak interval: ${config.pollIntervalPeakMs}ms, off-peak interval: ${config.pollIntervalOffPeakMs}ms, sleep interval: ${config.pollIntervalSleepMs}ms)`);

  const tick = () => {
    const startTime = Date.now();
    pollOnce(config, client, tokenProvider)
      .catch((err) => {
        console.error('Poll cycle failed:', err);
      })
      .finally(() => {
        const now = new Date();
        const period = computePeakPeriod(now);
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
