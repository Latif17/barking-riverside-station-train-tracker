// poller/src/index.ts
import { loadConfig } from './config.js';
import { createSupabaseClient } from './supabaseClient.js';
import {
  fetchPendingRows,
  fetchRecentlyResolvedRows,
  upsertRows,
  insertSeedRows,
  rowsExistForDate,
} from './repository.js';
import { fetchArrivals } from './tflClient.js';
import { fetchBarkingOutboundArrivals } from './barkingClient.js';
import { runPollCycle, VEHICLE_REUSE_COOLDOWN_MS } from './pollCycle.js';
import { buildSeedRows } from './schedule.js';
import { todayLondon, yesterdayLondon } from './dateHelpers.js';
import scheduleConfig from '../schedule.json' with { type: 'json' };
import type { ScheduleConfig } from './types.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

async function ensureTodaySeeded(client: ReturnType<typeof createSupabaseClient>, serviceDate: string) {
  // Checks for ANY row on this date, not just pending ones — otherwise a
  // poller restart late in the day (once every train has already resolved)
  // would see zero pending rows and try to reseed, hitting the schema's
  // unique constraint.
  const alreadySeeded = await rowsExistForDate(client, serviceDate);
  if (alreadySeeded) return;

  const seedRows = buildSeedRows(scheduleConfig as ScheduleConfig, serviceDate);
  if (seedRows.length === 0) {
    console.warn(`No scheduled services configured for ${serviceDate} (check schedule.json)`);
    return;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] would seed ${seedRows.length} rows for ${serviceDate}`);
    return;
  }
  await insertSeedRows(client, seedRows);
  console.log(`Seeded ${seedRows.length} scheduled services for ${serviceDate}`);
}

async function pollOnce(config: ReturnType<typeof loadConfig>, client: ReturnType<typeof createSupabaseClient>) {
  const serviceDate = todayLondon();
  await ensureTodaySeeded(client, serviceDate);

  const now = new Date();
  const cooldownSinceIso = new Date(now.getTime() - VEHICLE_REUSE_COOLDOWN_MS).toISOString();
  const yesterdayDate = yesterdayLondon();

  const [
    todayRows,
    yesterdayRows,
    recentlyResolvedToday,
    recentlyResolvedYesterday,
    terminusPredictions,
    barkingPredictions,
  ] = await Promise.all([
    fetchPendingRows(client, serviceDate),
    fetchPendingRows(client, yesterdayDate),
    fetchRecentlyResolvedRows(client, serviceDate, cooldownSinceIso),
    fetchRecentlyResolvedRows(client, yesterdayDate, cooldownSinceIso),
    fetchArrivals(config.tflStopPointId),
    fetchBarkingOutboundArrivals(config.barkingStopPointId, config.tflLineId),
  ]);
  // Resolved rows are included only so their vehicle_id remains visible to
  // runPollCycle's reuse-dedup and Barking-Riverside-presence checks (see
  // VEHICLE_REUSE_COOLDOWN_MS) — runPollCycle never mutates a row that
  // isn't 'pending', so merging them in here is safe.
  const pendingRows = [...todayRows, ...yesterdayRows, ...recentlyResolvedToday, ...recentlyResolvedYesterday];

  const changed = runPollCycle(pendingRows, terminusPredictions, barkingPredictions, now);

  if (changed.length === 0) return;

  if (DRY_RUN) {
    console.log(`[dry-run] would upsert ${changed.length} rows:`, changed);
    return;
  }
  await upsertRows(client, changed);
  console.log(`Updated ${changed.length} rows`);
}

async function main() {
  const config = loadConfig();
  const client = createSupabaseClient(config);

  console.log(`Starting poller (dry run: ${DRY_RUN}, interval: ${config.pollIntervalMs}ms)`);

  const tick = () => {
    pollOnce(config, client).catch((err) => {
      console.error('Poll cycle failed:', err);
    });
  };

  tick();
  setInterval(tick, config.pollIntervalMs);
}

main();
