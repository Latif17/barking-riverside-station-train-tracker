// poller/src/pollCycle.ts
import { directionFromDestinationNaptanId } from './direction.js';
import type { Direction, ScheduledServiceRow } from './types.js';
import type { TflPrediction } from './tflClient.js';

const MATCH_TOLERANCE_MS = 10 * 60 * 1000;       // 10 minutes
const ARRIVAL_CONFIRM_SECONDS = 90;               // must have been this close to count as "about to arrive"
const CANCELLATION_GRACE_MS = 15 * 60 * 1000;     // 15 minutes
const FORCE_RESOLVE_MS = 30 * 60 * 1000;          // 30 minutes
const DELAY_THRESHOLD_MINUTES = 3;

// A physical train's one-way trip on this line takes well over 30 minutes,
// so the same TfL vehicleId cannot legitimately produce two matches less
// than that far apart. 20 minutes comfortably covers the ~15-16 minute
// schedule spacing (the gap this guards against) while staying short enough
// to never block a genuine same-vehicle reuse later in the day. Callers
// (see repository.fetchRecentlyResolvedRows) must include already-resolved
// rows scheduled within this window so their vehicle_id stays visible to
// the dedup and Barking-Riverside-presence checks below — resolved rows
// aren't touched otherwise.
export const VEHICLE_REUSE_COOLDOWN_MS = 20 * 60 * 1000;

// Barking Riverside is a terminus: TfL's Arrivals feed there almost never
// carries an outbound (Gospel-Oak-bound) prediction more than a few seconds
// in advance, so timing departures off that feed biased on-time/delayed
// readings early by several minutes (it was capturing the train's
// arrival/reversal, not its actual departure). Barking — the very next stop
// outbound — gives a stable, advance-notice signal instead. Measured live
// across 6 vehicles on 2026-07-30: a consistent ~7 minute run time (range
// 6:44-7:00).
const BARKING_RIVERSIDE_TO_BARKING_RUN_MS = 7 * 60 * 1000;

function resolveArrival(row: ScheduledServiceRow): ScheduledServiceRow {
  // Project the last known countdown forward rather than using last_seen_at
  // raw: a train last seen 400s out at 06:58 most likely arrived around
  // 07:04:40, not at 06:58 itself. When last_seen_time_to_station is small
  // (the common case — we caught it right before it vanished from the feed)
  // this correction is only a few tens of seconds.
  const rawObservedMs =
    new Date(row.last_seen_at!).getTime() + (row.last_seen_time_to_station ?? 0) * 1000;
  // Departing rows are matched against Barking's feed, so their last-seen
  // countdown is time-to-Barking, not time-to-Barking-Riverside — back it
  // out here to get the estimated actual departure time from Barking
  // Riverside itself.
  const observedMs =
    row.direction === 'departing'
      ? rawObservedMs - BARKING_RIVERSIDE_TO_BARKING_RUN_MS
      : rawObservedMs;
  const observedTime = new Date(observedMs).toISOString();
  const delayMinutes = Math.round((observedMs - new Date(row.scheduled_time).getTime()) / 60000);
  return {
    ...row,
    status: delayMinutes > DELAY_THRESHOLD_MINUTES ? 'delayed' : 'on_time',
    observed_time: observedTime,
    delay_minutes: delayMinutes,
  };
}

function updateLastSeenIfAlreadyMatched(
  rowsById: Map<string, ScheduledServiceRow>,
  pendingRows: ScheduledServiceRow[],
  changed: Map<string, ScheduledServiceRow>,
  vehicleId: string,
  timeToStation: number,
  now: Date,
): boolean {
  const alreadyMatchedRow = pendingRows.find(
    (r) => r.vehicle_id === vehicleId && r.status === 'pending',
  );
  if (!alreadyMatchedRow) return false;

  const updated = {
    ...rowsById.get(alreadyMatchedRow.id!)!,
    last_seen_time_to_station: timeToStation,
    last_seen_at: now.toISOString(),
  };
  rowsById.set(alreadyMatchedRow.id!, updated);
  changed.set(alreadyMatchedRow.id!, updated);
  return true;
}

function matchNearestCandidate(
  rowsById: Map<string, ScheduledServiceRow>,
  changed: Map<string, ScheduledServiceRow>,
  direction: Direction,
  vehicleId: string,
  timeToStation: number,
  targetTimeMs: number,
  now: Date,
): boolean {
  const candidates = [...rowsById.values()].filter(
    (r) => r.direction === direction && r.status === 'pending' && !r.vehicle_id,
  );
  if (candidates.length === 0) return false;

  let nearest: ScheduledServiceRow | null = null;
  let nearestDiff = Infinity;
  for (const candidate of candidates) {
    const diff = Math.abs(new Date(candidate.scheduled_time).getTime() - targetTimeMs);
    if (diff < nearestDiff) {
      nearest = candidate;
      nearestDiff = diff;
    }
  }

  if (!nearest || nearestDiff > MATCH_TOLERANCE_MS) return false;

  const updated = {
    ...rowsById.get(nearest.id!)!,
    vehicle_id: vehicleId,
    last_seen_time_to_station: timeToStation,
    last_seen_at: now.toISOString(),
  };
  rowsById.set(nearest.id!, updated);
  changed.set(nearest.id!, updated);
  return true;
}

export function runPollCycle(
  pendingRows: ScheduledServiceRow[],
  terminusPredictions: TflPrediction[],
  barkingPredictions: TflPrediction[],
  now: Date,
): ScheduledServiceRow[] {
  const changed = new Map<string, ScheduledServiceRow>();
  const rowsById = new Map(pendingRows.map((r) => [r.id!, { ...r }]));

  const rowsWithVehicle = pendingRows.filter((r) => r.vehicle_id);
  // Any row (either direction, any status) that already carries a
  // vehicle_id proves that vehicle was physically at Barking Riverside —
  // this is the gate that stops a Barking-originated short working from
  // being credited as a Barking Riverside departure (see design doc
  // 2026-07-30-departing-accuracy-fix-design.md).
  const confirmedAtBarkingRiverside = new Set(rowsWithVehicle.map((r) => r.vehicle_id!));
  const usedForArriving = new Set(
    rowsWithVehicle.filter((r) => r.direction === 'arriving').map((r) => r.vehicle_id!),
  );
  const usedForDeparting = new Set(
    rowsWithVehicle.filter((r) => r.direction === 'departing').map((r) => r.vehicle_id!),
  );

  const seenAtTerminus = new Set<string>();
  const seenAtBarking = new Set<string>();

  for (const prediction of terminusPredictions) {
    // Barking Riverside's own feed only reliably reflects trains arriving
    // here — see BARKING_RIVERSIDE_TO_BARKING_RUN_MS above for why outbound
    // (departing) predictions from this feed are never matched any more.
    const direction = directionFromDestinationNaptanId(prediction.destinationNaptanId);
    if (direction !== 'arriving') continue;

    seenAtTerminus.add(prediction.vehicleId);

    if (
      updateLastSeenIfAlreadyMatched(
        rowsById,
        pendingRows,
        changed,
        prediction.vehicleId,
        prediction.timeToStation,
        now,
      )
    ) {
      continue;
    }

    if (usedForArriving.has(prediction.vehicleId)) continue;

    const matched = matchNearestCandidate(
      rowsById,
      changed,
      'arriving',
      prediction.vehicleId,
      prediction.timeToStation,
      new Date(prediction.expectedArrival).getTime(),
      now,
    );
    if (matched) {
      usedForArriving.add(prediction.vehicleId);
      confirmedAtBarkingRiverside.add(prediction.vehicleId);
    }
  }

  for (const prediction of barkingPredictions) {
    seenAtBarking.add(prediction.vehicleId);

    if (
      updateLastSeenIfAlreadyMatched(
        rowsById,
        pendingRows,
        changed,
        prediction.vehicleId,
        prediction.timeToStation,
        now,
      )
    ) {
      continue;
    }

    // Some services terminate at Barking and never reach Barking Riverside
    // — a Barking sighting alone doesn't prove this vehicle departed
    // Barking Riverside, only a prior sighting there (arriving, above) does.
    if (!confirmedAtBarkingRiverside.has(prediction.vehicleId)) continue;
    if (usedForDeparting.has(prediction.vehicleId)) continue;

    const matched = matchNearestCandidate(
      rowsById,
      changed,
      'departing',
      prediction.vehicleId,
      prediction.timeToStation,
      new Date(prediction.expectedArrival).getTime(),
      now,
    );
    if (matched) usedForDeparting.add(prediction.vehicleId);
  }

  for (const row of rowsById.values()) {
    if (row.status !== 'pending') continue;

    if (row.vehicle_id) {
      const stillSeen =
        row.direction === 'departing'
          ? seenAtBarking.has(row.vehicle_id)
          : seenAtTerminus.has(row.vehicle_id);

      if (!stillSeen) {
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
