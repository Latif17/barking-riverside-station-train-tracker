# Poller: Hybrid RTT and Static Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert to using a static schedule as the source of truth, and merge RTT live data onto it to instantly flag missing trains as cancelled.

**Architecture:** We will introduce a static `schedule.json` file and a `schedule.ts` helper to generate "expected" trains for a given day. The `rttClient.ts` will be updated to map its fetched live services against these expected trains. If an expected train is missing from the RTT feed, it is marked cancelled immediately.

**Tech Stack:** TypeScript, Node, Vitest.

## Global Constraints

- No live RTT API calls in any test — fixture/mock-based only.
- Strict mapping by `scheduled_time` (ISO string) and `direction` (`arriving` | `departing`).
- Missing expected trains must immediately transition to `status = 'cancelled'`.

---

### Task 1: Add Static Schedule Data & Helper

**Files:**
- Create: `poller/schedule.json`
- Create: `poller/src/schedule.ts`
- Create: `poller/test/schedule.test.ts`

**Interfaces:**
- Produces: `export function getScheduledServicesForDate(serviceDate: string): ScheduledServiceRow[]`

- [ ] **Step 1: Create `poller/schedule.json`**

```json
{
  "effective_from": "2026-05-17",
  "weekday": {
    "departing": [
      "05:33", "05:48", "06:03", "06:18", "06:33", "06:48", "07:03", "07:18", "07:33", "07:48",
      "08:03", "08:19", "08:36", "08:48", "09:03", "09:18", "09:33", "09:48", "10:03", "10:18",
      "10:33", "10:48", "11:03", "11:18", "11:36", "11:48", "12:03", "12:18", "12:33", "12:48",
      "13:03", "13:18", "13:33", "13:48", "14:03", "14:18", "14:33", "14:48", "15:03", "15:18",
      "15:35", "15:48", "16:03", "16:18", "16:33", "16:48", "17:03", "17:18", "17:33", "17:48",
      "18:03", "18:18", "18:35", "18:48", "19:03", "19:18", "19:33", "19:48", "20:03", "20:18",
      "20:33", "20:48", "21:03", "21:17", "21:33", "21:47", "22:03", "22:23", "22:43", "23:03",
      "23:23", "23:43"
    ],
    "arriving": [
      "00:11", "06:52", "07:04", "07:20", "07:34", "07:49", "08:04", "08:19", "08:34", "08:49",
      "09:04", "09:19", "09:35", "09:49", "10:04", "10:19", "10:34", "10:50", "11:04", "11:19",
      "11:35", "11:50", "12:04", "12:19", "12:34", "12:49", "13:04", "13:19", "13:34", "13:49",
      "14:04", "14:23", "14:34", "14:49", "15:04", "15:19", "15:36", "15:49", "16:04", "16:20",
      "16:34", "16:49", "17:04", "17:19", "17:34", "17:49", "18:04", "18:23", "18:34", "18:49",
      "19:04", "19:19", "19:34", "19:48", "20:04", "20:22", "20:34", "20:49", "21:04", "21:19",
      "21:34", "21:50", "22:04", "22:20", "22:32", "22:48", "23:09", "23:30", "23:50"
    ]
  },
  "saturday": {
    "departing": [
      "06:03", "06:18", "06:33", "06:48", "07:01", "07:18", "07:33", "07:48", "08:03", "08:18",
      "08:33", "08:48", "09:03", "09:18", "09:33", "09:48", "10:03", "10:18", "10:33", "10:51",
      "11:03", "11:18", "11:33", "11:48", "12:03", "12:18", "12:33", "12:48", "13:03", "13:18",
      "13:33", "13:48", "14:03", "14:18", "14:33", "14:48", "15:03", "15:18", "15:33", "15:48",
      "16:03", "16:18", "16:33", "16:48", "17:03", "17:18", "17:33", "17:48", "18:03", "18:18",
      "18:33", "18:48", "19:03", "19:18", "19:33", "19:48", "20:03", "20:18", "20:33", "20:48",
      "21:03", "21:17", "21:33", "21:47", "22:03", "22:23", "22:43", "23:00", "23:23", "23:41"
    ],
    "arriving": [
      "00:11", "06:52", "07:07", "07:20", "07:34", "07:49", "08:04", "08:19", "08:34", "08:49",
      "09:04", "09:19", "09:35", "09:49", "10:04", "10:19", "10:34", "10:49", "11:04", "11:19",
      "11:35", "11:50", "12:08", "12:19", "12:34", "12:49", "13:04", "13:19", "13:34", "13:49",
      "14:04", "14:23", "14:34", "14:49", "15:04", "15:19", "15:34", "15:49", "16:04", "16:20",
      "16:34", "16:49", "17:04", "17:19", "17:34", "17:49", "18:04", "18:23", "18:34", "18:49",
      "19:04", "19:19", "19:34", "19:49", "20:04", "20:19", "20:34", "20:49", "21:04", "21:19",
      "21:34", "21:50", "22:04", "22:20", "22:34", "22:50", "23:14", "23:34", "23:50"
    ]
  },
  "sunday": {
    "departing": [
      "08:48", "09:03", "09:19", "09:33", "09:48", "10:03", "10:18", "10:33", "10:48", "11:03",
      "11:18", "11:33", "11:48", "12:03", "12:18", "12:33", "12:48", "13:03", "13:18", "13:33",
      "13:48", "14:03", "14:18", "14:33", "14:48", "15:03", "15:18", "15:33", "15:48", "16:03",
      "16:18", "16:33", "16:48", "17:03", "17:18", "17:33", "17:48", "18:03", "18:18", "18:33",
      "18:48", "19:03", "19:18", "19:33", "19:48", "20:03", "20:18", "20:33", "20:48", "21:03",
      "21:18", "21:33", "21:47", "22:03", "22:21", "22:38", "23:01", "23:24"
    ],
    "arriving": [
      "00:05", "09:34", "09:49", "10:04", "10:19", "10:34", "10:49", "11:04", "11:19", "11:34",
      "11:49", "12:04", "12:19", "12:34", "12:49", "13:04", "13:19", "13:34", "13:49", "14:04",
      "14:19", "14:34", "14:49", "15:04", "15:19", "15:34", "15:49", "16:04", "16:19", "16:34",
      "16:49", "17:04", "17:19", "17:34", "17:49", "18:04", "18:19", "18:34", "18:49", "19:04",
      "19:19", "19:34", "19:49", "20:04", "20:19", "20:34", "20:49", "21:04", "21:19", "21:34",
      "21:49", "22:49", "23:13", "23:30", "23:50"
    ]
  }
}
```

- [ ] **Step 2: Write failing test in `poller/test/schedule.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { getScheduledServicesForDate } from '../src/schedule.js';

describe('schedule', () => {
  it('generates expected services for a Wednesday (weekday)', () => {
    // 2026-08-05 is a Wednesday
    const rows = getScheduledServicesForDate('2026-08-05');
    expect(rows.length).toBeGreaterThan(0);
    const firstDeparture = rows.find(r => r.direction === 'departing');
    expect(firstDeparture?.status).toBe('pending');
    expect(firstDeparture?.scheduled_time).toBe('2026-08-05T04:33:00.000Z'); // 05:33 BST -> 04:33 UTC
    expect(firstDeparture?.delay_minutes).toBe(0);
  });

  it('generates expected services for a Sunday', () => {
    // 2026-08-02 is a Sunday
    const rows = getScheduledServicesForDate('2026-08-02');
    expect(rows.some(r => r.direction === 'departing')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run poller/test/schedule.test.ts`
Expected: FAIL

- [ ] **Step 4: Write minimal implementation in `poller/src/schedule.ts`**

```typescript
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ScheduledServiceRow, Direction } from './types.js';
import { computePeakPeriod } from './peakPeriod.js';
import { londonTimeToUtcIso } from './dateHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ScheduleData {
  weekday: { departing: string[]; arriving: string[] };
  saturday: { departing: string[]; arriving: string[] };
  sunday: { departing: string[]; arriving: string[] };
}

let cachedSchedule: ScheduleData | null = null;

function loadSchedule(): ScheduleData {
  if (!cachedSchedule) {
    const raw = readFileSync(join(__dirname, '../schedule.json'), 'utf-8');
    cachedSchedule = JSON.parse(raw) as ScheduleData;
  }
  return cachedSchedule;
}

export function getScheduledServicesForDate(serviceDate: string): ScheduledServiceRow[] {
  const schedule = loadSchedule();
  const date = new Date(serviceDate);
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday

  let dayKey: 'weekday' | 'saturday' | 'sunday' = 'weekday';
  if (day === 0) dayKey = 'sunday';
  if (day === 6) dayKey = 'saturday';

  const daySchedule = schedule[dayKey];
  const rows: ScheduledServiceRow[] = [];

  for (const direction of ['departing', 'arriving'] as Direction[]) {
    for (const timeStr of daySchedule[direction]) {
      const scheduled_time = londonTimeToUtcIso(serviceDate, timeStr);
      rows.push({
        service_date: serviceDate,
        direction,
        scheduled_time,
        peak_period: computePeakPeriod(new Date(scheduled_time)),
        status: 'pending',
        observed_time: null,
        delay_minutes: 0,
        rtt_uid: null,
      });
    }
  }

  return rows;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run poller/test/schedule.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

Run: `git add poller/schedule.json poller/src/schedule.ts poller/test/schedule.test.ts && git commit -m "feat: add static schedule parsing"`

---

### Task 2: Merge RTT Data with Static Schedule

**Files:**
- Modify: `poller/src/rttClient.ts`
- Modify: `poller/test/rttClient.test.ts`

**Interfaces:**
- Consumes: `getScheduledServicesForDate`
- Produces: Updated `fetchTodayRows` that maps RTT services over expected ones.

- [ ] **Step 1: Write failing test in `poller/test/rttClient.test.ts`**

*(Note: we need to adapt the existing tests to assert that `fetchTodayRows` returns exactly the rows from the schedule, and that missing RTT trains are marked cancelled).*

Modify `poller/test/rttClient.test.ts` by adding a new test block:

```typescript
import { getScheduledServicesForDate } from '../src/schedule.js';

describe('fetchTodayRows hybrid merge', () => {
  it('marks expected train as cancelled if missing from RTT', async () => {
    // Assuming '2026-08-02' has a departure at "08:48" (Sunday)
    // We mock fetchFn to return an empty RTT response for the day.
    const mockEmptyFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ services: [] })
    });
    
    const rows = await fetchTodayRows(
      { rttBaseUrl: 'x', rttStationCode: 'BGV' },
      { getAccessToken: async () => 'tok', forceRefresh: async () => 'tok' },
      '2026-08-02',
      mockEmptyFetch
    );
    
    // The missing train should be returned, but marked as cancelled
    const firstDep = rows.find(r => r.direction === 'departing');
    expect(firstDep).toBeDefined();
    expect(firstDep!.status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `npx vitest run poller/test/rttClient.test.ts`
Expected: FAIL (because currently `fetchTodayRows` only returns trains found in RTT)

- [ ] **Step 3: Update `fetchTodayRows` in `poller/src/rttClient.ts`**

```typescript
import { getScheduledServicesForDate } from './schedule.js';

// Inside poller/src/rttClient.ts
// Replace the old fetchTodayRows with this:

export async function fetchTodayRows(
  config: RttClientConfig,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fetchFn: typeof fetch = fetch,
): Promise<ScheduledServiceRow[]> {
  const [morning, evening] = await Promise.all([
    fetchLocationWindow(config, tokenProvider, serviceDate, '00:00', '12:00', fetchFn),
    fetchLocationWindow(config, tokenProvider, serviceDate, '12:00', '23:59', fetchFn),
  ]);

  const allRttServices = [...morning, ...evening];
  
  // Create a fast lookup map: "scheduled_time|direction" -> RttService
  const rttMap = new Map<string, ScheduledServiceRow>();
  for (const s of allRttServices) {
    const mappedRows = mapRttServiceToRows(s);
    for (const r of mappedRows) {
      rttMap.set(`${r.scheduled_time}|${r.direction}`, r);
    }
  }

  // Get source of truth schedule
  const expectedRows = getScheduledServicesForDate(serviceDate);

  // Merge live data
  for (const row of expectedRows) {
    const rttRow = rttMap.get(`${row.scheduled_time}|${row.direction}`);
    if (rttRow) {
      // Train found in RTT: use its status and times
      row.status = rttRow.status;
      row.observed_time = rttRow.observed_time;
      row.delay_minutes = rttRow.delay_minutes;
      row.rtt_uid = rttRow.rtt_uid;
    } else {
      // Train completely missing from RTT: it was cancelled early
      row.status = 'cancelled';
    }
  }

  return expectedRows;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run poller/test/rttClient.test.ts`
Expected: PASS (fix any existing tests that assumed output length matched RTT exactly, as they now match the static schedule length).

- [ ] **Step 5: Commit**

Run: `git add poller/src/rttClient.ts poller/test/rttClient.test.ts && git commit -m "feat: merge RTT live data with static schedule"`

---

### Task 3: Adjust Poller Loop

**Files:**
- Modify: `poller/src/index.ts`

**Interfaces:**
- Consumes: The updated `fetchTodayRows`.

- [ ] **Step 1: Verify `index.ts` works with the new `fetchTodayRows`**

Since `fetchTodayRows` signature hasn't changed (it takes `config, tokenProvider, serviceDate, fetchFn`), the main poll loop in `index.ts` should actually work seamlessly without major changes. Wait, in `index.ts` we might have a safety check for `FORCE_RESOLVE_MS` or similar. Let's make sure it handles all expected rows. The new `fetchTodayRows` naturally handles marking missing rows as `cancelled`.

If `index.ts` has a block marking `pending` rows > 30 minutes old as `cancelled`, this is now largely redundant since missing RTT rows are instantly cancelled. However, it's safe to leave as a secondary fallback.

To be clean, simply verify tests still pass.

Run: `npx vitest run poller/test`
Expected: PASS

- [ ] **Step 2: Commit**

Run: `git commit --allow-empty -m "chore: verify index loop integration with hybrid scheduler"`

---
