// poller/test/pollCycle.test.ts
import { describe, it, expect } from 'vitest';
import { runPollCycle } from '../src/pollCycle.js';
import type { ScheduledServiceRow } from '../src/types.js';
import type { TflPrediction } from '../src/tflClient.js';

function row(overrides: Partial<ScheduledServiceRow>): ScheduledServiceRow {
  return {
    id: 'row-1',
    service_date: '2026-07-29',
    direction: 'arriving',
    scheduled_time: '2026-07-29T07:00:00.000Z',
    peak_period: 'am_peak',
    status: 'pending',
    observed_time: null,
    delay_minutes: null,
    vehicle_id: null,
    last_seen_time_to_station: null,
    last_seen_at: null,
    ...overrides,
  };
}

describe('runPollCycle — arriving direction (Barking Riverside terminus feed)', () => {
  it('matches an unmatched prediction to the nearest pending row of the same direction', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GBARKRIV', // -> arriving
        timeToStation: 600,
        expectedArrival: '2026-07-29T07:02:00.000Z',
      },
    ];

    const changed = runPollCycle(rows, predictions, [], new Date('2026-07-29T06:52:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('a');
    expect(changed[0].vehicle_id).toBe('veh-1');
    expect(changed[0].status).toBe('pending');
    expect(changed[0].last_seen_time_to_station).toBe(600);
  });

  it('matches two predictions in the same poll to two different rows, even when both are nearest to the same row', () => {
    // Regression test: candidates must be sourced from rows already matched
    // earlier in this SAME poll cycle, not from the stale pendingRows
    // snapshot — otherwise two predictions that are both nearest to row 'a'
    // (07:01 and 07:02 are both much closer to 07:00 than to 07:10) would
    // collide on row 'a', silently overwriting the first match and leaving
    // row 'b' unmatched.
    const rows = [
      row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' }),
      row({ id: 'b', scheduled_time: '2026-07-29T07:10:00.000Z' }),
    ];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GBARKRIV',
        timeToStation: 60,
        expectedArrival: '2026-07-29T07:01:00.000Z', // nearest to 'a' (1 min vs 9 min)
      },
      {
        vehicleId: 'veh-2',
        destinationNaptanId: '910GBARKRIV',
        timeToStation: 120,
        expectedArrival: '2026-07-29T07:02:00.000Z', // also nearest to 'a' (2 min vs 8 min)
      },
    ];

    const changed = runPollCycle(rows, predictions, [], new Date('2026-07-29T06:52:00.000Z'));

    expect(changed).toHaveLength(2);
    const byId = new Map(changed.map((r) => [r.id, r]));
    const vehicleIds = new Set(changed.map((r) => r.vehicle_id));
    expect(vehicleIds.size).toBe(2);
    expect(byId.get('a')?.vehicle_id).toBeTruthy();
    expect(byId.get('b')?.vehicle_id).toBeTruthy();
    expect(byId.get('a')?.vehicle_id).not.toBe(byId.get('b')?.vehicle_id);
  });

  it('does not match a prediction more than 10 minutes from any pending scheduled_time', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GBARKRIV',
        timeToStation: 600,
        expectedArrival: '2026-07-29T07:20:00.000Z', // 20 min away, out of tolerance
      },
    ];

    const changed = runPollCycle(rows, predictions, [], new Date('2026-07-29T06:52:00.000Z'));
    expect(changed).toHaveLength(0);
  });

  it('resolves a matched row as on_time when it disappears shortly after being close to arrival', () => {
    const rows = [
      row({
        id: 'a',
        scheduled_time: '2026-07-29T07:00:00.000Z',
        vehicle_id: 'veh-1',
        last_seen_time_to_station: 45,
        last_seen_at: '2026-07-29T07:00:30.000Z',
      }),
    ];
    // veh-1 no longer appears in this poll's predictions.
    const changed = runPollCycle(rows, [], [], new Date('2026-07-29T07:02:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe('on_time');
    expect(changed[0].observed_time).toBe('2026-07-29T07:01:15.000Z');
    expect(changed[0].delay_minutes).toBe(1);
  });

  it('resolves a matched row as delayed when observed more than 3 minutes late', () => {
    const rows = [
      row({
        id: 'a',
        scheduled_time: '2026-07-29T07:00:00.000Z',
        vehicle_id: 'veh-1',
        last_seen_time_to_station: 30,
        last_seen_at: '2026-07-29T07:05:00.000Z',
      }),
    ];
    const changed = runPollCycle(rows, [], [], new Date('2026-07-29T07:06:00.000Z'));

    expect(changed[0].status).toBe('delayed');
    expect(changed[0].observed_time).toBe('2026-07-29T07:05:30.000Z');
    expect(changed[0].delay_minutes).toBe(6);
  });

  it('does not resolve a matched row that is still being seen with a large timeToStation', () => {
    const rows = [
      row({
        id: 'a',
        scheduled_time: '2026-07-29T07:00:00.000Z',
        vehicle_id: 'veh-1',
        last_seen_time_to_station: 500,
        last_seen_at: '2026-07-29T06:52:00.000Z',
      }),
    ];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GBARKRIV',
        timeToStation: 460,
        expectedArrival: '2026-07-29T07:00:00.000Z',
      },
    ];
    const changed = runPollCycle(rows, predictions, [], new Date('2026-07-29T06:53:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe('pending');
    expect(changed[0].last_seen_time_to_station).toBe(460);
  });

  it('force-resolves a matched-but-unconfirmed row 30 minutes after scheduled_time using last known data', () => {
    const rows = [
      row({
        id: 'a',
        scheduled_time: '2026-07-29T07:00:00.000Z',
        vehicle_id: 'veh-1',
        last_seen_time_to_station: 400,
        last_seen_at: '2026-07-29T06:58:00.000Z',
      }),
    ];
    const changed = runPollCycle(rows, [], [], new Date('2026-07-29T07:31:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe('delayed');
    expect(changed[0].observed_time).toBe('2026-07-29T07:04:40.000Z');
    expect(changed[0].delay_minutes).toBe(5);
  });

  it('ignores predictions with an unrecognised destination', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GUNKNOWN',
        timeToStation: 600,
        expectedArrival: '2026-07-29T07:02:00.000Z',
      },
    ];
    const changed = runPollCycle(rows, predictions, [], new Date('2026-07-29T06:52:00.000Z'));
    expect(changed).toHaveLength(0);
  });

  it('does not match a departing-tagged terminus prediction — departing is only sourced from Barking', () => {
    // Barking Riverside's own feed almost never carries a stable outbound
    // prediction (see design doc 2026-07-30) — a Gospel-Oak-destined sighting
    // here must never be used to match a departing row any more.
    const rows = [row({ id: 'a', direction: 'departing', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 2,
        expectedArrival: '2026-07-29T07:00:02.000Z',
      },
    ];
    const changed = runPollCycle(rows, predictions, [], new Date('2026-07-29T07:00:00.000Z'));
    expect(changed).toHaveLength(0);
  });
});

describe('runPollCycle — cancellation (direction-agnostic)', () => {
  it('marks an unmatched pending row as cancelled after the 15 minute grace period', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const changed = runPollCycle(rows, [], [], new Date('2026-07-29T07:16:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe('cancelled');
  });

  it('does not cancel an unmatched pending row still within the grace period', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const changed = runPollCycle(rows, [], [], new Date('2026-07-29T07:10:00.000Z'));

    expect(changed).toHaveLength(0);
  });
});

describe('runPollCycle — departing direction (Barking confirmation)', () => {
  it('matches a Barking outbound sighting to the nearest pending departing row, given a prior confirmed Barking Riverside sighting', () => {
    const priorArrival = row({
      id: 'prior-arrival',
      direction: 'arriving',
      scheduled_time: '2026-07-29T06:52:00.000Z',
      status: 'on_time',
      vehicle_id: 'veh-1',
      observed_time: '2026-07-29T06:52:30.000Z',
      delay_minutes: 1,
    });
    const departingCandidate = row({
      id: 'departing',
      direction: 'departing',
      scheduled_time: '2026-07-29T07:03:00.000Z',
    });
    const barkingPredictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 400,
        expectedArrival: '2026-07-29T07:10:00.000Z', // minus 7 min run time -> ~07:03:00
      },
    ];

    const changed = runPollCycle(
      [priorArrival, departingCandidate],
      [],
      barkingPredictions,
      new Date('2026-07-29T07:03:20.000Z'),
    );

    const departingChange = changed.find((r) => r.id === 'departing');
    expect(departingChange).toBeTruthy();
    expect(departingChange!.vehicle_id).toBe('veh-1');
    expect(departingChange!.status).toBe('pending');
    expect(departingChange!.last_seen_time_to_station).toBe(400);
  });

  it('ignores a Barking outbound sighting when the vehicle was never confirmed at Barking Riverside (short-formed at Barking)', () => {
    const departingCandidate = row({
      id: 'departing',
      direction: 'departing',
      scheduled_time: '2026-07-29T07:03:00.000Z',
    });
    const barkingPredictions: TflPrediction[] = [
      {
        vehicleId: 'veh-short-formed',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 400,
        expectedArrival: '2026-07-29T07:10:00.000Z',
      },
    ];

    const changed = runPollCycle([departingCandidate], [], barkingPredictions, new Date('2026-07-29T07:03:20.000Z'));

    expect(changed).toHaveLength(0);
  });

  it('resolves a departing row using the Barking Riverside-to-Barking run-time offset', () => {
    const departingRow = row({
      id: 'departing',
      direction: 'departing',
      scheduled_time: '2026-07-29T07:03:00.000Z',
      vehicle_id: 'veh-1',
      last_seen_time_to_station: 30,
      last_seen_at: '2026-07-29T07:09:30.000Z', // projects to 07:10:00 at Barking
    });
    // veh-1 no longer appears in Barking's predictions this poll.
    const changed = runPollCycle([departingRow], [], [], new Date('2026-07-29T07:11:00.000Z'));

    expect(changed).toHaveLength(1);
    // raw projection: 07:09:30 + 30s = 07:10:00; minus 7 min run time = 07:03:00 -> exactly on time
    expect(changed[0].status).toBe('on_time');
    expect(changed[0].observed_time).toBe('2026-07-29T07:03:00.000Z');
    expect(changed[0].delay_minutes).toBe(0);
  });

  it('does not re-match a vehicle_id to a new departing row once it has already resolved an earlier departing row', () => {
    // Regression test: a full one-way trip on this line takes well over 30
    // minutes, so the same vehicleId reappearing at Barking a few minutes
    // after it already resolved an earlier departing row cannot be a genuine
    // second departure. Relies on the caller (index.ts) having included the
    // already-resolved row in the input array (see
    // repository.fetchRecentlyResolvedRows) so its vehicle_id remains
    // visible to the dedup check, even though it's no longer 'pending'.
    const priorArrival = row({
      id: 'prior-arrival',
      direction: 'arriving',
      scheduled_time: '2026-07-29T06:52:00.000Z',
      status: 'on_time',
      vehicle_id: 'veh-1',
      observed_time: '2026-07-29T06:52:30.000Z',
      delay_minutes: 1,
    });
    const resolvedDeparting = row({
      id: 'a',
      direction: 'departing',
      scheduled_time: '2026-07-29T07:00:00.000Z',
      status: 'on_time',
      vehicle_id: 'veh-1',
      observed_time: '2026-07-29T06:58:00.000Z',
      delay_minutes: -2,
    });
    const newDepartingCandidate = row({
      id: 'b',
      direction: 'departing',
      scheduled_time: '2026-07-29T07:15:00.000Z',
    });
    const barkingPredictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 60,
        expectedArrival: '2026-07-29T07:16:00.000Z',
      },
    ];

    const changed = runPollCycle(
      [priorArrival, resolvedDeparting, newDepartingCandidate],
      [],
      barkingPredictions,
      new Date('2026-07-29T07:15:00.000Z'),
    );

    expect(changed).toHaveLength(0);
  });
});
