// poller/src/index.ts
import { loadConfig } from './config.js';
import { createSupabaseClient } from './supabaseClient.js';
import { fetchPendingRows, upsertScheduledServices } from './repository.js';
import { createTokenProvider } from './rttAuth.js';
import { fetchTodayRows } from './rttClient.js';
import { applyForceResolveFallback } from './forceResolve.js';
import { todayLondon } from './dateHelpers.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

async function pollOnce(
  config: ReturnType<typeof loadConfig>,
  client: ReturnType<typeof createSupabaseClient>,
  tokenProvider: ReturnType<typeof createTokenProvider>,
) {
  const serviceDate = todayLondon();
  const now = new Date();

  const [freshRows, pendingRows] = await Promise.all([
    fetchTodayRows(config, tokenProvider, serviceDate),
    fetchPendingRows(client, serviceDate),
  ]);

  const forceResolvedRows = applyForceResolveFallback(pendingRows, freshRows, now);
  const rowsToUpsert = [...freshRows, ...forceResolvedRows];

  if (rowsToUpsert.length === 0) return;

  if (DRY_RUN) {
    console.log(`[dry-run] would upsert ${rowsToUpsert.length} rows:`, rowsToUpsert);
    return;
  }
  await upsertScheduledServices(client, rowsToUpsert);
  console.log(`Upserted ${rowsToUpsert.length} rows`);
}

async function main() {
  const config = loadConfig();
  const client = createSupabaseClient(config);
  const tokenProvider = createTokenProvider({
    baseUrl: config.rttBaseUrl,
    refreshToken: config.rttRefreshToken,
  });

  console.log(`Starting poller (dry run: ${DRY_RUN}, interval: ${config.pollIntervalMs}ms)`);

  const tick = () => {
    pollOnce(config, client, tokenProvider).catch((err) => {
      console.error('Poll cycle failed:', err);
    });
  };

  tick();
  setInterval(tick, config.pollIntervalMs);
}

main();
