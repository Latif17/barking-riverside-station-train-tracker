// poller/src/pollCycle.ts
import { directionFromDestinationNaptanId } from './direction.js';
import type { ScheduledServiceRow } from './types.js';
import type { TflPrediction } from './tflClient.js';

const MATCH_TOLERANCE_MS = 10 * 60 * 1000;       // 10 minutes
const ARRIVAL_CONFIRM_SECONDS = 90;               // must have been this close to count as "about to arrive"
const CANCELLATION_GRACE_MS = 15 * 60 * 1000;     // 15 minutes
const FORCE_RESOLVE_MS = 30 * 60 * 1000;          // 30 minutes
const DELAY_THRESHOLD_MINUTES = 3;

function resolveArrival(row: ScheduledServiceRow): ScheduledServiceRow {
  // Project the last known countdown forward rather than using last_seen_at
  // raw: a train last seen 400s out at 06:58 most likely arrived around
  // 07:04:40, not at 06:58 itself. When last_seen_time_to_station is small
  // (the common case — we caught it right before it vanished from the feed)
  // this correction is only a few tens of seconds.
  const observedTimeMs =
    new Date(row.last_seen_at!).getTime() + (row.last_seen_time_to_station ?? 0) * 1000;
  const observedTime = new Date(observedTimeMs).toISOString();
  const delayMinutes = Math.round(
    (observedTimeMs - new Date(row.scheduled_time).getTime()) / 60000,
  );
  return {
    ...row,
    status: delayMinutes > DELAY_THRESHOLD_MINUTES ? 'delayed' : 'on_time',
    observed_time: observedTime,
    delay_minutes: delayMinutes,
  };
}

export function runPollCycle(
  pendingRows: ScheduledServiceRow[],
  predictions: TflPrediction[],
  now: Date,
): ScheduledServiceRow[] {
  const changed = new Map<string, ScheduledServiceRow>();
  const rowsById = new Map(pendingRows.map((r) => [r.id!, { ...r }]));
  const matchedVehicleIds = new Set(
    pendingRows.filter((r) => r.vehicle_id).map((r) => r.vehicle_id!),
  );
  const seenVehicleIds = new Set<string>();

  for (const prediction of predictions) {
    const direction = directionFromDestinationNaptanId(prediction.destinationNaptanId);
    if (!direction) continue;

    seenVehicleIds.add(prediction.vehicleId);

    const alreadyMatchedRow = pendingRows.find(
      (r) => r.vehicle_id === prediction.vehicleId && r.status === 'pending',
    );
    if (alreadyMatchedRow) {
      const updated = {
        ...rowsById.get(alreadyMatchedRow.id!)!,
        last_seen_time_to_station: prediction.timeToStation,
        last_seen_at: now.toISOString(),
      };
      rowsById.set(alreadyMatchedRow.id!, updated);
      changed.set(alreadyMatchedRow.id!, updated);
      continue;
    }

    if (matchedVehicleIds.has(prediction.vehicleId)) continue; // matched to a row not in this pendingRows batch

    const candidates = [...rowsById.values()].filter(
      (r) => r.direction === direction && r.status === 'pending' && !r.vehicle_id,
    );
    if (candidates.length === 0) continue;

    const predictedTime = new Date(prediction.expectedArrival).getTime();
    let nearest: ScheduledServiceRow | null = null;
    let nearestDiff = Infinity;
    for (const candidate of candidates) {
      const diff = Math.abs(new Date(candidate.scheduled_time).getTime() - predictedTime);
      if (diff < nearestDiff) {
        nearest = candidate;
        nearestDiff = diff;
      }
    }

    if (nearest && nearestDiff <= MATCH_TOLERANCE_MS) {
      const updated = {
        ...rowsById.get(nearest.id!)!,
        vehicle_id: prediction.vehicleId,
        last_seen_time_to_station: prediction.timeToStation,
        last_seen_at: now.toISOString(),
      };
      rowsById.set(nearest.id!, updated);
      changed.set(nearest.id!, updated);
      matchedVehicleIds.add(prediction.vehicleId);
    }
  }

  for (const row of rowsById.values()) {
    if (row.status !== 'pending') continue;

    if (row.vehicle_id && !seenVehicleIds.has(row.vehicle_id)) {
      const closeEnough =
        row.last_seen_time_to_station !== null &&
        row.last_seen_time_to_station !== undefined &&
        row.last_seen_time_to_station <= ARRIVAL_CONFIRM_SECONDS;
      const timeSinceScheduled = now.getTime() - new Date(row.scheduled_time).getTime();

      if (closeEnough || timeSinceScheduled >= FORCE_RESOLVE_MS) {
        const resolved = resolveArrival(row);
        rowsById.set(row.id!, resolved);
        changed.set(row.id!, resolved);
        continue;
      }
    }

    if (!row.vehicle_id) {
      const timeSinceScheduled = now.getTime() - new Date(row.scheduled_time).getTime();
      if (timeSinceScheduled >= CANCELLATION_GRACE_MS) {
        const cancelled = { ...row, status: 'cancelled' as const };
        rowsById.set(row.id!, cancelled);
        changed.set(row.id!, cancelled);
      }
    }
  }

  return [...changed.values()];
}
