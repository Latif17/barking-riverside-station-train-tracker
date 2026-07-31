# Departing-Direction Accuracy Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the poller's "departing" (Barking Riverside → Gospel Oak) on-time/delayed/cancelled classification as accurate as the already-correct "arriving" direction, by sourcing departure confirmation from Barking station instead of the unreliable Barking Riverside terminus feed.

**Architecture:** Add a second TfL polling target (`StopPoint/910GBARKING/Arrivals`, filtered to the Suffragette line's Gospel-Oak-bound predictions). A departing scheduled row is only resolved from a Barking sighting if that vehicle was previously confirmed present at Barking Riverside (via an existing arriving-direction match) — this rules out services that start their outbound working at Barking itself without ever having reached Barking Riverside. The observed departure time is Barking's predicted arrival time minus a fixed ~7 minute run-time offset (measured live from real TfL data). All of this lives in the pure `runPollCycle` function and its two callers (`index.ts`, `repository.ts`); no schema or frontend change.

**Tech Stack:** TypeScript, Node, `tsx`, Vitest, Supabase JS client, TfL Unified API (no auth key required).

## Global Constraints

- No new npm dependencies.
- No Supabase schema changes.
- No frontend changes.
- No live TfL API calls in any test — fixture data only (matches existing `tflClient.test.ts` / `test/fixtures/arrivals.json` pattern).
- Every new/changed piece of pure logic gets a unit test before the implementation is written (TDD), per the project's existing test style in `poller/test/`.
- Run `npx vitest run` and `npx tsc --noEmit` from the `poller/` directory after every task; both must be clean before moving to the next task.

---

### Task 1: Barking outbound-arrivals client

**Files:**
- Create: `poller/src/barkingClient.ts`
- Create: `poller/test/fixtures/barkingArrivals.json`
- Test: `poller/test/barkingClient.test.ts`

**Interfaces:**
- Consumes: `TflPrediction` type from `poller/src/tflClient.ts` (already exists: `{ vehicleId: string; destinationNaptanId: string; timeToStation: number; expectedArrival: string }`).
- Produces: `fetchBarkingOutboundArrivals(barkingStopPointId: string, lineId: string, fetchFn?: typeof fetch): Promise<TflPrediction[]>` — used by Task 4.

- [ ] **Step 1: Create the fixture file**

Create `poller/test/fixtures/barkingArrivals.json`. This simulates a real `StopPoint/910GBARKING/Arrivals` response — Barking is a multi-line interchange, so the fixture includes a Suffragette train heading to Gospel Oak (the one we want), a Suffragette train heading the other way to Barking Riverside (must be filtered out — wrong direction), and a different line's train (must be filtered out — wrong `lineId`), to prove both filters work:

```json
[
  {
    "vehicleId": "202607307106962",
    "naptanId": "910GBARKING",
    "lineId": "suffragette",
    "destinationNaptanId": "910GGOSPLOK",
    "destinationName": "Gospel Oak Rail Station",
    "timeToStation": 245,
    "expectedArrival": "2026-07-30T09:09:00Z"
  },
  {
    "vehicleId": "202607306734472",
    "naptanId": "910GBARKING",
    "lineId": "suffragette",
    "destinationNaptanId": "910GBARKRIV",
    "destinationName": "Barking Riverside",
    "timeToStation": 441,
    "expectedArrival": "2026-07-30T09:12:16Z"
  },
  {
    "vehicleId": "some-other-line-vehicle",
    "naptanId": "910GBARKING",
    "lineId": "c2c",
    "destinationNaptanId": "910GGOSPLOK",
    "destinationName": "Irrelevant",
    "timeToStation": 100,
    "expectedArrival": "2026-07-30T09:05:00Z"
  }
]
```

- [ ] **Step 2: Write the failing test**

Create `poller/test/barkingClient.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchBarkingOutboundArrivals } from '../src/barkingClient.js';
import fixture from './fixtures/barkingArrivals.json' with { type: 'json' };

describe('fetchBarkingOutboundArrivals', () => {
  it('fetches the correct URL and returns only Gospel-Oak-bound predictions on the given line', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const predictions = await fetchBarkingOutboundArrivals(
      '910GBARKING',
      'suffragette',
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).toHaveBeenCalledWith('https://api.tfl.gov.uk/StopPoint/910GBARKING/Arrivals');
    expect(predictions).toEqual([
      {
        vehicleId: '202607307106962',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 245,
        expectedArrival: '2026-07-30T09:09:00Z',
      },
    ]);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(
      fetchBarkingOutboundArrivals('910GBARKING', 'suffragette', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

From `poller/`, run: `npx vitest run test/barkingClient.test.ts`
Expected: FAIL — `Cannot find module '../src/barkingClient.js'` (or similar), since the module doesn't exist yet.

- [ ] **Step 4: Write the implementation**

Create `poller/src/barkingClient.ts`:

```ts
// poller/src/barkingClient.ts
import type { TflPrediction } from './tflClient.js';

const GOSPEL_OAK_NAPTAN_ID = '910GGOSPLOK';

interface RawTflPrediction {
  vehicleId: string;
  lineId: string;
  destinationNaptanId: string;
  timeToStation: number;
  expectedArrival: string;
}

export async function fetchBarkingOutboundArrivals(
  barkingStopPointId: string,
  lineId: string,
  fetchFn: typeof fetch = fetch,
): Promise<TflPrediction[]> {
  const url = `https://api.tfl.gov.uk/StopPoint/${barkingStopPointId}/Arrivals`;
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(`TfL Arrivals request failed with status ${response.status}`);
  }

  const raw = (await response.json()) as RawTflPrediction[];

  return raw
    .filter((p) => p.lineId === lineId && p.destinationNaptanId === GOSPEL_OAK_NAPTAN_ID)
    .map((p) => ({
      vehicleId: p.vehicleId,
      destinationNaptanId: p.destinationNaptanId,
      timeToStation: p.timeToStation,
      expectedArrival: p.expectedArrival,
    }));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/barkingClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add poller/src/barkingClient.ts poller/test/barkingClient.test.ts poller/test/fixtures/barkingArrivals.json
git commit -m "Add Barking outbound-arrivals client for departing confirmation"
```

---

### Task 2: Config — add Barking stop point ID

**Files:**
- Modify: `poller/src/config.ts`
- Test: `poller/test/config.test.ts`

**Interfaces:**
- Produces: `Config.barkingStopPointId: string` (value `'910GBARKING'`) — used by Task 4. `Config.tflLineId` (already exists, previously unused) is now consumed by Task 4 too.

- [ ] **Step 1: Write the failing test**

In `poller/test/config.test.ts`, add one line inside the `'loads required values from env and applies defaults'` test, right after the `tflStopPointId` assertion:

```ts
    expect(config.tflStopPointId).toBe('910GBARKRIV');
    expect(config.barkingStopPointId).toBe('910GBARKING');
    expect(config.tflLineId).toBe('suffragette');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `config.barkingStopPointId` is `undefined`, not `'910GBARKING'`.

- [ ] **Step 3: Update the implementation**

In `poller/src/config.ts`, add the field to the `Config` interface and `loadConfig`'s return value:

```ts
export interface Config {
  tflStopPointId: string;
  barkingStopPointId: string;
  tflLineId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  pollIntervalMs: number;
}
```

```ts
export function loadConfig(): Config {
  return {
    tflStopPointId: '910GBARKRIV',
    barkingStopPointId: '910GBARKING',
    tflLineId: 'suffragette',
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalMs: process.env.POLL_INTERVAL_MS
      ? Number(process.env.POLL_INTERVAL_MS)
      : 45000,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add poller/src/config.ts poller/test/config.test.ts
git commit -m "Add Barking stop point ID to poller config"
```

---

### Task 3: Rewrite `runPollCycle` — source departing confirmation from Barking

This is the core change. `runPollCycle` gains a third parameter (`barkingPredictions`), stops matching the "departing" direction from the Barking Riverside terminus feed (it was only ever briefly and unreliably present there — see the design doc), and instead matches departing rows from Barking sightings, gated on the vehicle having a prior confirmed Barking Riverside presence.

**Files:**
- Modify: `poller/src/pollCycle.ts` (full rewrite)
- Modify: `poller/test/pollCycle.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `TflPrediction` (from `tflClient.ts`), `ScheduledServiceRow`, `Direction` (from `types.ts`).
- Produces: `runPollCycle(pendingRows: ScheduledServiceRow[], terminusPredictions: TflPrediction[], barkingPredictions: TflPrediction[], now: Date): ScheduledServiceRow[]` — **signature change**: this now takes 4 arguments instead of 3 (the new third argument is `barkingPredictions`, inserted before `now`). Used by Task 4. `VEHICLE_REUSE_COOLDOWN_MS` (already exported, unchanged) is still used by `index.ts`.

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `poller/test/pollCycle.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/pollCycle.test.ts`
Expected: FAIL — `runPollCycle` still has the old 3-argument signature, so every call in this file (now passing 4 arguments) will either error at the type level (if checked) or misbehave at runtime (the 3rd argument `now`/`barkingPredictions` will be interpreted as the wrong parameter). This confirms the file is exercising behavior that doesn't exist yet.

- [ ] **Step 3: Replace the implementation**

Replace the entire contents of `poller/src/pollCycle.ts` with:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/pollCycle.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all test files pass (note: `index.ts` will fail to typecheck at this point because it still calls `runPollCycle` with the old 3-argument signature — that's expected and fixed in Task 4. If `tsc --noEmit` errors, confirm the *only* error is in `src/index.ts` about `runPollCycle`'s argument count before proceeding.)

- [ ] **Step 6: Commit**

```bash
git add poller/src/pollCycle.ts poller/test/pollCycle.test.ts
git commit -m "Source departing-direction confirmation from Barking instead of the terminus feed"
```

---

### Task 4: Wire Barking polling into the poll loop

**Files:**
- Modify: `poller/src/index.ts`

**Interfaces:**
- Consumes: `fetchBarkingOutboundArrivals` (Task 1), `Config.barkingStopPointId` / `Config.tflLineId` (Task 2), `runPollCycle`'s new 4-argument signature (Task 3).

- [ ] **Step 1: Update imports and the `pollOnce` function**

In `poller/src/index.ts`, add the import:

```ts
import { fetchArrivals } from './tflClient.js';
import { fetchBarkingOutboundArrivals } from './barkingClient.js';
```

Then update `pollOnce` so the `Promise.all` also fetches Barking's predictions, and pass them as the new third argument to `runPollCycle`:

```ts
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
```

(Only the `Promise.all` array and the `runPollCycle` call change — everything else in `pollOnce`, and the rest of the file, stays as-is.)

- [ ] **Step 2: Typecheck and run the full suite**

From `poller/`, run: `npx tsc --noEmit && npx vitest run`
Expected: both clean — 0 TypeScript errors, all test files passing.

- [ ] **Step 3: Commit**

```bash
git add poller/src/index.ts
git commit -m "Wire Barking outbound polling into the poll loop"
```

---

### Task 5: Verify against live data and restart the poller

This task has no automated test — it's a manual sanity check against the real TfL API before trusting the change in production, matching the project's existing convention ("run the poller in dry-run/log-only mode against real data... before enabling writes", per the Phase 1 design doc).

**Files:** none (verification only).

- [ ] **Step 1: Dry-run against live TfL data**

From `poller/`, run for ~2-3 minutes and watch the log output:

```bash
DRY_RUN=true npx tsx --env-file=.env src/index.ts
```

Confirm:
- No errors fetching either `StopPoint/910GBARKRIV/Arrivals` or `StopPoint/910GBARKING/Arrivals`.
- Any departing row that gets matched shows a `vehicle_id` that also appears (or previously appeared) on an `arriving` row in the same log session — if one ever shows up with no corresponding arriving match at all, stop and re-check the `confirmedAtBarkingRiverside` gate logic before proceeding.

Stop the process with Ctrl-C once satisfied.

- [ ] **Step 2: Restart the live poller process**

A poller instance may already be running locally from earlier in this project (started via `npx tsx --env-file=.env src/index.ts`, not in watch mode, so it's still holding the pre-fix code in memory). Find and stop it, then start a fresh one:

```bash
ps aux | grep '[t]sx.*src/index.ts'   # find the PID(s)
kill <PID>                            # stop the old process
cd poller && npm start                # restart with the new code
```

- [ ] **Step 3: Spot-check tomorrow morning's data**

Once a morning's worth of departing rows have resolved, query them the same way used during validation earlier in this project (via the Supabase REST API with the service-role key, or the Supabase dashboard) and confirm departing `delay_minutes` values now cluster near 0 instead of showing the previous systematic -7 to -10 minute bias.
