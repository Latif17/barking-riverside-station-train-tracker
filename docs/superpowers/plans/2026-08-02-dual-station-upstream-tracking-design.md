# Dual-Station Upstream Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the poller to fetch data for both Barking Riverside and Barking upstream concurrently, merging the results to track upstream ghost trains.

**Architecture:** Add upstream tracking columns to the Supabase `scheduled_services` table. Refactor `fetchTodayRows` to return un-merged raw Maps of trains. The main polling loop will query both RTT APIs, merge the data in-memory into the static schedule, and handle ghost train cleanup for both independently.

**Tech Stack:** TypeScript, Supabase (SQL migrations), Node.js fetch

## Global Constraints

- The existing `(service_date, direction, scheduled_time)` unique constraint remains exactly as is.
- The aggressive 30-minute timeout for ghost trains will apply to BOTH stations independently.
- The `inPassengerService === false` filter will apply to both API streams.

---

### Task 1: Database Migration and Types Update

**Files:**
- Create: `supabase/migrations/20260803000000_upstream_tracking.sql`
- Modify: `poller/src/types.ts`
- Modify: `poller/src/repository.ts`

**Interfaces:**
- Produces: `ScheduledServiceRow` with `upstream_status`, `upstream_observed_time`, `upstream_delay_minutes` fields.

- [ ] **Step 1: Write the database migration**

Create `supabase/migrations/20260803000000_upstream_tracking.sql`:

```sql
alter table scheduled_services 
  add column upstream_status text check (upstream_status in ('pending', 'on_time', 'delayed', 'cancelled'));

alter table scheduled_services 
  add column upstream_observed_time timestamptz;

alter table scheduled_services 
  add column upstream_delay_minutes integer;
```

- [ ] **Step 2: Update TypeScript types**

Update `poller/src/types.ts` to include the new fields:

```typescript
// poller/src/types.ts

import type { PeakPeriod } from './peakPeriod.js';
export type { PeakPeriod };
export type Direction = 'departing' | 'arriving';
export type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled';

export interface ScheduledServiceRow {
  id?: string;
  service_date: string;
  direction: Direction;
  scheduled_time: string;
  peak_period: PeakPeriod;
  status: ServiceStatus;
  observed_time?: string | null;
  delay_minutes?: number | null;
  rtt_uid: string | null;
  upstream_status?: ServiceStatus;
  upstream_observed_time?: string | null;
  upstream_delay_minutes?: number | null;
}
```

- [ ] **Step 3: Update repository logic**

Update `poller/src/repository.ts` to include the new fields in `upsertScheduledServices`. Modify `sanitizedRows` mapping:

```typescript
  const sanitizedRows = rows.map((row) => ({
    service_date: row.service_date,
    direction: row.direction,
    scheduled_time: row.scheduled_time,
    peak_period: row.peak_period,
    status: row.status,
    observed_time: row.observed_time ?? null,
    delay_minutes: row.delay_minutes ?? null,
    rtt_uid: row.rtt_uid,
    upstream_status: row.upstream_status ?? null,
    upstream_observed_time: row.upstream_observed_time ?? null,
    upstream_delay_minutes: row.upstream_delay_minutes ?? null,
  }));
```

### Task 4: Configuration and Tokens

**Files:**
- Modify: `poller/src/config.ts`

**Interfaces:**
- Consumes: Environment variables `RTT_REFRESH_TOKEN_2` and `RTT_BASE_URL_2`.
- Produces: Extended `Config` interface used by the main poller loop.

- [ ] **Step 1: Update config types and parsing**

Modify `poller/src/config.ts` to require `rttRefreshToken2` and add `rttStationCode2` and `rttBaseUrl2`:

```typescript
export interface Config {
  rttBaseUrl: string;
  rttBaseUrl2: string;
  rttStationCode: string;
  rttStationCode2: string;
  rttRefreshToken: string;
  rttRefreshToken2: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  pollIntervalPeakMs: number;
  pollIntervalOffPeakMs: number;
  pollIntervalSleepMs: number;
}
```

And in `loadConfig()`:

```typescript
export function loadConfig(): Config {
  return {
    rttBaseUrl: 'https://data.rtt.io',
    rttBaseUrl2: process.env.RTT_BASE_URL_2 || 'https://data.rtt.io',
    rttStationCode: 'gb-nr:BGV',
    rttStationCode2: 'gb-nr:BKG',
    rttRefreshToken: requireEnv('RTT_REFRESH_TOKEN'),
    rttRefreshToken2: requireEnv('RTT_REFRESH_TOKEN_2'),
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalPeakMs: process.env.POLL_INTERVAL_PEAK_MS
      ? Number(process.env.POLL_INTERVAL_PEAK_MS)
      : 40000,
    pollIntervalOffPeakMs: process.env.POLL_INTERVAL_OFF_PEAK_MS
      ? Number(process.env.POLL_INTERVAL_OFF_PEAK_MS)
      : 120000,
    pollIntervalSleepMs: process.env.POLL_INTERVAL_SLEEP_MS
      ? Number(process.env.POLL_INTERVAL_SLEEP_MS)
      : 60000,
  };
}
```

### Task 5: Refactor RTT Client to return un-merged Maps

**Files:**
- Modify: `poller/src/rttClient.ts`
- Modify: `poller/test/rttClient.test.ts`

**Interfaces:**
- Consumes: Nothing new.
- Produces: `fetchTodayRows` returns `Promise<Map<string, ScheduledServiceRow>>`.

- [ ] **Step 1: Update `fetchLocationWindow` options**

In `poller/src/rttClient.ts`, remove `RttClientConfig` (since `config.ts` has the full config) and update `fetchLocationWindow` to take query options:

```typescript
// Remove RttClientConfig interface

async function fetchLocationWindow(
  baseUrl: string,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fromHhmm: string,
  toHhmm: string,
  options: { code: string; filterTo?: string },
  fetchFn: typeof fetch,
): Promise<RttService[]> {
  const timeFrom = londonTimeToUtcIso(serviceDate, fromHhmm);
  const timeTo = londonTimeToUtcIso(serviceDate, toHhmm);
  let url = `${baseUrl}/rtt/location?code=${options.code}&timeFrom=${timeFrom}&timeTo=${timeTo}`;
  
  if (options.filterTo) {
    url += `&filterTo=${options.filterTo}`;
  }

  const request = (token: string) => fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
// ... rest remains same
```

- [ ] **Step 2: Update `fetchTodayRows` to return a Map**

Replace the existing `fetchTodayRows` function:

```typescript
export async function fetchTodayRows(
  baseUrl: string,
  tokenProvider: TokenProvider,
  serviceDate: string,
  options: { code: string; filterTo?: string },
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, ScheduledServiceRow>> {
  const allRttServices = await fetchLocationWindow(baseUrl, tokenProvider, serviceDate, '00:00', '23:59', options, fetchFn);

  // Create a fast lookup map: "scheduled_time|direction" -> RttService
  const rttMap = new Map<string, ScheduledServiceRow>();
  for (const s of allRttServices) {
    const mappedRows = mapRttServiceToRows(s);
    for (const r of mappedRows) {
      rttMap.set(`${r.scheduled_time}|${r.direction}`, r);
    }
  }

  return rttMap;
}
```

- [ ] **Step 3: Fix `poller/test/rttClient.test.ts`**

Update `rttClient.test.ts` to expect a Map and remove hybrid merge logic.
In `describe('fetchTodayRows')` tests, change:

```typescript
    const rowsMap = await fetchTodayRows(
      'https://data.rtt.io',
      makeTokenProvider(),
      '2026-07-31',
      { code: 'BGV' },
      mockFetch as unknown as typeof fetch,
    );
    const rows = Array.from(rowsMap.values());
```

And delete the `describe('fetchTodayRows hybrid merge', () => { ... })` block entirely since it tests the logic we just removed.

### Task 6: Dual stream merge in polling logic

**Files:**
- Modify: `poller/src/index.ts`
- Modify: `poller/test/index.test.ts`

**Interfaces:**
- Consumes: `fetchTodayRows` returning Map, `Config` with multiple codes.
- Produces: Fully merged `ScheduledServiceRow[]` ready for DB upsert.

- [ ] **Step 1: Update `pollOnce` to fetch and merge two streams**

Modify `poller/src/index.ts`:

```typescript
// Replace the single `fetchTodayRows` and `fetchAllRowsForDate` fetch with:

export async function pollOnce(
  config: ReturnType<typeof loadConfig>,
  client: ReturnType<typeof createSupabaseClient>,
  tokenProvider1: ReturnType<typeof createTokenProvider>,
  tokenProvider2: ReturnType<typeof createTokenProvider>,
) {
  const now = new Date();
  if (getPollingState(now) === 'sleep') {
    return;
  }

  const serviceDate = todayLondon();

  const [bgvMap, bkgMap, dbRows] = await Promise.all([
    fetchTodayRows(config.rttBaseUrl, tokenProvider1, serviceDate, { code: config.rttStationCode }),
    fetchTodayRows(config.rttBaseUrl2, tokenProvider2, serviceDate, { code: config.rttStationCode2, filterTo: config.rttStationCode }),
    fetchAllRowsForDate(client, serviceDate),
  ]);

  const expectedRows = getScheduledServicesForDate(serviceDate);
  const nowMs = Date.now();

  const freshRows = expectedRows.map((row) => {
    const bgvRow = bgvMap.get(`${row.scheduled_time}|${row.direction}`);
    const bkgRow = bkgMap.get(`${row.scheduled_time}|${row.direction}`);
    const timeSinceScheduled = nowMs - new Date(row.scheduled_time).getTime();

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

    if (bkgRow) {
      row.upstream_status = bkgRow.status;
      row.upstream_observed_time = bkgRow.observed_time;
      row.upstream_delay_minutes = bkgRow.delay_minutes;

      if (row.upstream_status === 'pending' && timeSinceScheduled >= 30 * 60 * 1000) {
        row.upstream_status = 'cancelled';
      }
    } else {
      row.upstream_status = 'cancelled';
    }

    return row;
  });

  const pendingRows = dbRows.filter((r) => r.status === 'pending');
  const forceResolvedRows = applyForceResolveFallback(pendingRows, freshRows, now);
// ...
```

- [ ] **Step 2: Initialize second token provider in `main()`**

In `poller/src/index.ts` `main()`:

```typescript
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
// ...
```

- [ ] **Step 3: Update `poller/test/index.test.ts`**

Update `pollOnce` calls in tests to pass 4 arguments, and mock `fetchTodayRows` to return a `Map`:

```typescript
  beforeEach(() => {
    fetchTodayRowsSpy = vi.spyOn(rttClient, 'fetchTodayRows').mockResolvedValue(new Map());
    fetchAllRowsForDateSpy = vi.spyOn(repository, 'fetchAllRowsForDate').mockResolvedValue([]);
  });

// ... inside the test:

    await pollOnce(dummyConfig as any, {} as any, {} as any, {} as any);
```
