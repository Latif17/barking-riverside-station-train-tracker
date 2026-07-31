# RTT Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the poller's TfL Arrivals + `schedule.json` + vehicle-matching heuristics with the Realtime Trains (RTT) next-generation API, which reports scheduled time, actual/forecast time, and an explicit cancellation flag per service directly.

**Architecture:** A new `rttAuth.ts` manages the refresh-token → short-lived-access-token exchange with in-memory caching. A new `rttClient.ts` queries `GET /rtt/location?code=BGV` (two windows per day, since RTT caps a single query at 23h59m) and maps each returned service straight into a `ScheduledServiceRow` — no seeding step, no vehicle matching. `index.ts`'s poll loop becomes: fetch fresh rows from RTT, fetch today's still-`pending` DB rows, run a 30-minute force-resolve fallback for anything RTT no longer mentions, upsert everything on the table's natural unique key.

**Tech Stack:** TypeScript (strict), Node.js native `fetch`, Vitest, Supabase JS client — no new dependencies.

## Global Constraints

- RTT base URL: `https://data.rtt.io`. Station code: `BGV` (Barking Riverside's CRS code).
- Auth: bearer token. `GET /api/get_access_token` (refresh token as bearer) returns `{ token, entitlements, validUntil }` — cache the access token, refresh when within 60 seconds of `validUntil`.
- Delay threshold unchanged at 3 minutes (`realtimeAdvertisedLateness > 3` → `delayed`).
- A full service day is queried in exactly two calls per poll cycle: London-local `00:00`–`12:00` and `12:00`–`23:59` (RTT's single-query cap is 23h59m).
- `service_date` for a row is the London calendar date of its own `scheduled_time` — not the date of the query window that returned it (see design doc's accepted behavior change for the last train of the night).
- No live RTT API calls in any test — fixture/mock-based only, matching this repo's existing testing convention.
- The 30-minute force-resolve fallback is a safety net for RTT data gaps, not the primary cancellation-detection path (RTT's own `isCancelled` is primary).
- The DB migration is committed to the repo but **not** auto-applied — per this project's existing convention, the user applies it manually via the Supabase SQL editor or `supabase db push`.
- No new dependencies — use Node's native `fetch`.

---

### Task 1: Add `londonTimeToUtcIso` to `dateHelpers.ts`

**Files:**
- Modify: `poller/src/dateHelpers.ts`
- Test: `poller/test/dateHelpers.test.ts`

**Interfaces:**
- Produces: `londonTimeToUtcIso(serviceDate: string, hhmm: string): string` — converts a London-local `HH:MM` on a given `YYYY-MM-DD` date into a UTC ISO string. Used by `rttClient.ts` (Task 5) to build RTT query windows.
- `todayLondon()` and `yesterdayLondon()` (both already exist) are unchanged in this task.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `poller/test/dateHelpers.test.ts` with:

```typescript
// poller/test/dateHelpers.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayLondon, yesterdayLondon, londonTimeToUtcIso } from '../src/dateHelpers.js';

describe('todayLondon', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current London calendar date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(todayLondon()).toBe('2026-07-15');
  });

  it('reflects the date just after the BST midnight rollover', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T23:30:00Z')); // 00:30 BST on 03-30
    expect(todayLondon()).toBe('2026-03-30');
  });
});

describe('yesterdayLondon', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the previous day within a normal month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(yesterdayLondon()).toBe('2026-07-14');
  });

  it('rolls back across a month boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    expect(yesterdayLondon()).toBe('2026-02-28');
  });

  it('rolls back across a year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    expect(yesterdayLondon()).toBe('2025-12-31');
  });

  it('handles the London midnight rollover just after BST transition (late March)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T23:30:00Z'));
    expect(yesterdayLondon()).toBe('2026-03-29');
  });
});

describe('londonTimeToUtcIso', () => {
  it('converts London local HH:MM to correct UTC instant across BST', () => {
    // 2026-07-29 is BST (UTC+1): 07:00 London = 06:00 UTC
    expect(londonTimeToUtcIso('2026-07-29', '07:00')).toBe('2026-07-29T06:00:00.000Z');
  });

  it('converts London local HH:MM to correct UTC instant in GMT (winter)', () => {
    // 2026-01-05 is GMT (UTC+0): 07:03 London = 07:03 UTC
    expect(londonTimeToUtcIso('2026-01-05', '07:03')).toBe('2026-01-05T07:03:00.000Z');
  });

  it('handles late evening times in BST without day-wrap corruption', () => {
    // 2026-07-29 is BST (UTC+1): 23:15 London = 22:15 UTC, same calendar day
    expect(londonTimeToUtcIso('2026-07-29', '23:15')).toBe('2026-07-29T22:15:00.000Z');
  });

  it('handles the 12:00 boundary time used for RTT window splits', () => {
    expect(londonTimeToUtcIso('2026-07-29', '12:00')).toBe('2026-07-29T11:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd poller && npx vitest run test/dateHelpers.test.ts`
Expected: FAIL — `londonTimeToUtcIso is not a function` (it doesn't exist in `dateHelpers.ts` yet).

- [ ] **Step 3: Implement `londonTimeToUtcIso`**

Append to `poller/src/dateHelpers.ts` (after the existing `yesterdayLondon` function):

```typescript

function londonUtcOffsetHoursForDate(serviceDate: string): number {
  // Anchor at local noon so we never straddle a day boundary or a DST
  // transition (which happen at 01:00/02:00 local, not noon).
  const noonUtcGuess = new Date(`${serviceDate}T12:00:00.000Z`);
  const londonHourAtNoon = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(noonUtcGuess),
  );
  return londonHourAtNoon - 12;
}

export function londonTimeToUtcIso(serviceDate: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);
  const offsetHours = londonUtcOffsetHoursForDate(serviceDate);
  const [year, month, day] = serviceDate.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0));
  return utc.toISOString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npx vitest run test/dateHelpers.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add poller/src/dateHelpers.ts poller/test/dateHelpers.test.ts
git commit -m "feat(poller): add londonTimeToUtcIso for RTT query windows"
```

---

### Task 2: Rename `vehicle_id` → `rtt_uid` in types and DB schema

**Files:**
- Modify: `poller/src/types.ts`
- Create: `supabase/migrations/0003_rtt_migration.sql`

**Interfaces:**
- Produces: `ScheduledServiceRow` with `rtt_uid?: string | null` replacing `vehicle_id`, and `last_seen_time_to_station` / `last_seen_at` removed. `ScheduleConfig` and `DaySchedule` are removed (no longer used once `schedule.json` is retired in Task 9).
- This is a type-only change plus a SQL file; there's no test to write for either, so this task has no red/green cycle — verify via `npm test` still passing (nothing currently imports the removed types except files being deleted in Task 9) and eyeballing the SQL.

- [ ] **Step 1: Replace `poller/src/types.ts`**

```typescript
// poller/src/types.ts

export type Direction = 'departing' | 'arriving';
export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';
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
  rtt_uid?: string | null;
}
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0003_rtt_migration.sql`:

```sql
-- Migrates scheduled_services from the TfL-vehicle-matching model to the
-- RTT model: vehicle_id becomes a plain RTT service reference id, and the
-- TfL-specific "last seen countdown" columns (only needed for the old
-- vehicle-matching heuristics) are dropped.

alter table scheduled_services
  rename column vehicle_id to rtt_uid;

alter table scheduled_services
  drop column last_seen_time_to_station,
  drop column last_seen_at;
```

- [ ] **Step 3: Run the full test suite to confirm nothing currently depends on the removed types**

Run: `cd poller && npm test`
Expected: The suite still passes. (`pollCycle.test.ts`, `repository.test.ts`, and `schedule.test.ts` construct row objects with the old field names or reference `ScheduleConfig` — since Vitest transpiles TypeScript without type-checking, these still run and pass at this point; they'll be rewritten/deleted in Tasks 7 and 9.)

- [ ] **Step 4: Commit**

```bash
git add poller/src/types.ts supabase/migrations/0003_rtt_migration.sql
git commit -m "feat(poller): rename vehicle_id to rtt_uid, drop TfL-only tracking columns"
```

**Note for whoever runs this in Supabase:** apply `0003_rtt_migration.sql` via the Supabase SQL Editor (or `supabase db push`) before deploying the new poller — same manual-apply convention as `0001_init.sql` and `0002_set_updated_at_trigger.sql` (see `poller/README.md`).

---

### Task 3: Replace TfL config with RTT config

**Files:**
- Modify: `poller/src/config.ts`
- Modify: `poller/.env.example`
- Test: `poller/test/config.test.ts`

**Interfaces:**
- Produces: `Config` with `rttBaseUrl: string`, `rttStationCode: string`, `rttRefreshToken: string` replacing `tflStopPointId`, `barkingStopPointId`, `tflLineId`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `poller/test/config.test.ts`:

```typescript
// poller/test/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.RTT_REFRESH_TOKEN = 'test-refresh-token';
    delete process.env.POLL_INTERVAL_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads required values from env and applies defaults', () => {
    const config = loadConfig();
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.supabaseServiceRoleKey).toBe('test-key');
    expect(config.rttRefreshToken).toBe('test-refresh-token');
    expect(config.rttBaseUrl).toBe('https://data.rtt.io');
    expect(config.rttStationCode).toBe('BGV');
    expect(config.pollIntervalMs).toBe(45000);
  });

  it('respects POLL_INTERVAL_MS override', () => {
    process.env.POLL_INTERVAL_MS = '30000';
    expect(loadConfig().pollIntervalMs).toBe(30000);
  });

  it('throws if SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL;
    expect(() => loadConfig()).toThrow(/SUPABASE_URL/);
  });

  it('throws if SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => loadConfig()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('throws if RTT_REFRESH_TOKEN is missing', () => {
    delete process.env.RTT_REFRESH_TOKEN;
    expect(() => loadConfig()).toThrow(/RTT_REFRESH_TOKEN/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npx vitest run test/config.test.ts`
Expected: FAIL — `config.rttRefreshToken` is `undefined` / throws about `RTT_REFRESH_TOKEN` not being recognized, since `config.ts` doesn't read it yet.

- [ ] **Step 3: Replace `poller/src/config.ts`**

```typescript
// poller/src/config.ts

export interface Config {
  rttBaseUrl: string;
  rttStationCode: string;
  rttRefreshToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  pollIntervalMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    rttBaseUrl: 'https://data.rtt.io',
    rttStationCode: 'BGV',
    rttRefreshToken: requireEnv('RTT_REFRESH_TOKEN'),
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalMs: process.env.POLL_INTERVAL_MS
      ? Number(process.env.POLL_INTERVAL_MS)
      : 45000,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `.env.example`**

Replace the contents of `poller/.env.example`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
RTT_REFRESH_TOKEN=your-rtt-refresh-token
POLL_INTERVAL_MS=45000
```

- [ ] **Step 6: Commit**

```bash
git add poller/src/config.ts poller/test/config.test.ts poller/.env.example
git commit -m "feat(poller): replace TfL config with RTT config"
```

---

### Task 4: RTT token provider (`rttAuth.ts`)

**Files:**
- Create: `poller/src/rttAuth.ts`
- Test: `poller/test/rttAuth.test.ts`

**Interfaces:**
- Produces: `RttAuthConfig { baseUrl: string; refreshToken: string }`, `TokenProvider { getAccessToken(now?: Date): Promise<string>; forceRefresh(): Promise<string> }`, `createTokenProvider(config: RttAuthConfig, fetchFn?: typeof fetch): TokenProvider`. `forceRefresh` always requests a new token regardless of cache state, for the data-call 401-retry path in `rttClient.ts`.
- Consumes: nothing from earlier tasks.
- Used by: `rttClient.ts` (Task 5) and `index.ts` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `poller/test/rttAuth.test.ts`:

```typescript
// poller/test/rttAuth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTokenProvider } from '../src/rttAuth.js';

describe('createTokenProvider', () => {
  it('fetches an access token using the refresh token as the bearer', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'access-1', validUntil: '2026-07-31T08:00:00Z', entitlements: [] }),
    });

    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    const token = await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));

    expect(token).toBe('access-1');
    expect(mockFetch).toHaveBeenCalledWith('https://data.rtt.io/api/get_access_token', {
      headers: { Authorization: 'Bearer refresh-token-abc' },
    });
  });

  it('reuses the cached token while still valid', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'access-1', validUntil: '2026-07-31T08:00:00Z' }),
    });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));
    const token = await provider.getAccessToken(new Date('2026-07-31T07:30:00Z'));

    expect(token).toBe('access-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes once the cached token is within the 60-second expiry buffer', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-1', validUntil: '2026-07-31T07:01:00Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-2', validUntil: '2026-07-31T08:00:00Z' }),
      });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));
    // 07:00:05 is only 55s before the 07:01:00 expiry — inside the 60s buffer.
    const token = await provider.getAccessToken(new Date('2026-07-31T07:00:05Z'));

    expect(token).toBe('access-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await expect(provider.getAccessToken(new Date('2026-07-31T07:00:00Z'))).rejects.toThrow(/401/);
  });

  it('forceRefresh always requests a new token, bypassing the cache', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-1', validUntil: '2026-07-31T08:00:00Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-2', validUntil: '2026-07-31T09:00:00Z' }),
      });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));
    const token = await provider.forceRefresh();

    expect(token).toBe('access-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npx vitest run test/rttAuth.test.ts`
Expected: FAIL — `Cannot find module '../src/rttAuth.js'`.

- [ ] **Step 3: Implement `poller/src/rttAuth.ts`**

```typescript
// poller/src/rttAuth.ts

export interface RttAuthConfig {
  baseUrl: string;
  refreshToken: string;
}

export interface TokenProvider {
  getAccessToken(now?: Date): Promise<string>;
}

interface CachedToken {
  token: string;
  validUntilMs: number;
}

interface AccessTokenResponse {
  token: string;
  validUntil: string;
}

const REFRESH_BUFFER_MS = 60 * 1000;

export function createTokenProvider(
  config: RttAuthConfig,
  fetchFn: typeof fetch = fetch,
): TokenProvider {
  let cached: CachedToken | null = null;

  async function requestNewToken(): Promise<string> {
    const response = await fetchFn(`${config.baseUrl}/api/get_access_token`, {
      headers: { Authorization: `Bearer ${config.refreshToken}` },
    });

    if (!response.ok) {
      throw new Error(`RTT get_access_token failed with status ${response.status}`);
    }

    const body = (await response.json()) as AccessTokenResponse;
    cached = { token: body.token, validUntilMs: new Date(body.validUntil).getTime() };
    return cached.token;
  }

  async function getAccessToken(now: Date = new Date()): Promise<string> {
    if (cached && cached.validUntilMs - REFRESH_BUFFER_MS > now.getTime()) {
      return cached.token;
    }
    return requestNewToken();
  }

  return { getAccessToken, forceRefresh: requestNewToken };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npx vitest run test/rttAuth.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add poller/src/rttAuth.ts poller/test/rttAuth.test.ts
git commit -m "feat(poller): add RTT access-token provider with caching"
```

---

### Task 5: RTT client — fetch + map to rows (`rttClient.ts`)

**Files:**
- Create: `poller/src/rttClient.ts`
- Create: `poller/test/fixtures/rttLocation.json`
- Test: `poller/test/rttClient.test.ts`

**Interfaces:**
- Consumes: `TokenProvider` from `rttAuth.ts` (Task 4), `londonTimeToUtcIso` from `dateHelpers.ts` (Task 1), `computePeakPeriod` from `peakPeriod.ts` (existing, unchanged), `ScheduledServiceRow` from `types.ts` (Task 2).
- Produces: `RttClientConfig { rttBaseUrl: string; rttStationCode: string }`, `mapRttServiceToRow(service: RttService): ScheduledServiceRow | null`, `fetchTodayRows(config: RttClientConfig, tokenProvider: TokenProvider, serviceDate: string, fetchFn?: typeof fetch): Promise<ScheduledServiceRow[]>`.
- Used by: `index.ts` (Task 8).

- [ ] **Step 1: Create the fixture**

Create `poller/test/fixtures/rttLocation.json`:

```json
{
  "services": [
    {
      "scheduleMetadata": { "uniqueIdentity": "gb-nr:L01500:2026-07-31" },
      "temporalData": {
        "arrival": {
          "scheduleAdvertised": "2026-07-31T07:04:00Z",
          "isCancelled": true,
          "cancellationReasonCode": "TB"
        }
      }
    },
    {
      "scheduleMetadata": { "uniqueIdentity": "gb-nr:L01525:2026-07-31" },
      "temporalData": {
        "departure": {
          "scheduleAdvertised": "2026-07-31T07:18:00Z",
          "realtimeActual": "2026-07-31T07:23:12Z",
          "realtimeAdvertisedLateness": 5,
          "isCancelled": false
        }
      }
    },
    {
      "scheduleMetadata": { "uniqueIdentity": "gb-nr:L01530:2026-07-31" },
      "temporalData": {
        "arrival": {
          "scheduleAdvertised": "2026-07-31T07:34:00Z",
          "realtimeActual": "2026-07-31T07:35:00Z",
          "realtimeAdvertisedLateness": 1,
          "isCancelled": false
        }
      }
    },
    {
      "scheduleMetadata": { "uniqueIdentity": "gb-nr:L01545:2026-07-31" },
      "temporalData": {
        "departure": {
          "scheduleAdvertised": "2026-07-31T09:03:00Z"
        }
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `poller/test/rttClient.test.ts`:

```typescript
// poller/test/rttClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mapRttServiceToRow, fetchTodayRows } from '../src/rttClient.js';
import { londonTimeToUtcIso } from '../src/dateHelpers.js';
import { computePeakPeriod } from '../src/peakPeriod.js';
import { createTokenProvider } from '../src/rttAuth.js';
import fixture from './fixtures/rttLocation.json' with { type: 'json' };

const [cancelledArrival, delayedDeparture, onTimeArrival, pendingDeparture] = fixture.services;

function makeTokenProvider() {
  return createTokenProvider(
    { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-abc' },
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'access-abc', validUntil: '2026-07-31T23:59:59Z' }),
    }) as unknown as typeof fetch,
  );
}

describe('mapRttServiceToRow', () => {
  it('maps a cancelled arrival', () => {
    const row = mapRttServiceToRow(cancelledArrival);
    expect(row).toEqual({
      service_date: '2026-07-31',
      direction: 'arriving',
      scheduled_time: '2026-07-31T07:04:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T07:04:00.000Z')),
      status: 'cancelled',
      rtt_uid: 'gb-nr:L01500:2026-07-31',
    });
  });

  it('maps a delayed departure using realtimeAdvertisedLateness directly', () => {
    const row = mapRttServiceToRow(delayedDeparture);
    expect(row).toEqual({
      service_date: '2026-07-31',
      direction: 'departing',
      scheduled_time: '2026-07-31T07:18:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T07:18:00.000Z')),
      status: 'delayed',
      observed_time: '2026-07-31T07:23:12.000Z',
      delay_minutes: 5,
      rtt_uid: 'gb-nr:L01525:2026-07-31',
    });
  });

  it('maps an on-time arrival (lateness at or below the 3-minute threshold)', () => {
    const row = mapRttServiceToRow(onTimeArrival);
    expect(row?.status).toBe('on_time');
    expect(row?.delay_minutes).toBe(1);
  });

  it('maps a not-yet-run service as pending', () => {
    const row = mapRttServiceToRow(pendingDeparture);
    expect(row).toEqual({
      service_date: '2026-07-31',
      direction: 'departing',
      scheduled_time: '2026-07-31T09:03:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T09:03:00.000Z')),
      status: 'pending',
      rtt_uid: 'gb-nr:L01545:2026-07-31',
    });
  });

  it('returns null for a service with neither arrival nor departure scheduled', () => {
    expect(mapRttServiceToRow({ temporalData: {} })).toBeNull();
  });
});

describe('fetchTodayRows', () => {
  it('queries the morning and evening windows and maps every returned service', async () => {
    const morningFrom = londonTimeToUtcIso('2026-07-31', '00:00');
    const eveningFrom = londonTimeToUtcIso('2026-07-31', '12:00');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(`timeFrom=${morningFrom}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ services: [cancelledArrival, delayedDeparture] }),
        };
      }
      if (url.includes(`timeFrom=${eveningFrom}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ services: [onTimeArrival, pendingDeparture] }),
        };
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const rows = await fetchTodayRows(
      { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
      makeTokenProvider(),
      '2026-07-31',
      mockFetch as unknown as typeof fetch,
    );

    expect(rows).toHaveLength(4);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('code=BGV');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer access-abc' } });
  });

  it('retries once after a 401 by forcing a token refresh', async () => {
    const tokenFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-1', validUntil: '2026-07-31T23:59:59Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-2', validUntil: '2026-07-31T23:59:59Z' }),
      });
    const tokenProvider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-abc' },
      tokenFetch as unknown as typeof fetch,
    );

    const seenUrls = new Set<string>();
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const alreadyTried = seenUrls.has(url);
      seenUrls.add(url);

      if (!alreadyTried) {
        return { ok: false, status: 401 };
      }
      expect(init.headers).toEqual({ Authorization: 'Bearer access-2' });
      return { ok: true, status: 200, json: async () => ({ services: [] }) };
    });

    const rows = await fetchTodayRows(
      { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
      tokenProvider,
      '2026-07-31',
      mockFetch as unknown as typeof fetch,
    );

    expect(rows).toEqual([]);
    // 2 windows, each first tried with the cached token (401), then retried
    // once after forceRefresh — 4 calls total.
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('treats a 204 response as no services', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

    const rows = await fetchTodayRows(
      { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
      makeTokenProvider(),
      '2026-07-31',
      mockFetch as unknown as typeof fetch,
    );

    expect(rows).toEqual([]);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(
      fetchTodayRows(
        { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
        makeTokenProvider(),
        '2026-07-31',
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd poller && npx vitest run test/rttClient.test.ts`
Expected: FAIL — `Cannot find module '../src/rttClient.js'`.

- [ ] **Step 4: Implement `poller/src/rttClient.ts`**

```typescript
// poller/src/rttClient.ts
import { computePeakPeriod } from './peakPeriod.js';
import { londonTimeToUtcIso } from './dateHelpers.js';
import type { Direction, ScheduledServiceRow } from './types.js';
import type { TokenProvider } from './rttAuth.js';

const DELAY_THRESHOLD_MINUTES = 3;

export interface RttIndividualTemporalData {
  scheduleAdvertised?: string;
  realtimeActual?: string;
  realtimeForecast?: string;
  realtimeAdvertisedLateness?: number;
  isCancelled?: boolean;
}

export interface RttService {
  scheduleMetadata?: {
    uniqueIdentity?: string;
  };
  temporalData?: {
    arrival?: RttIndividualTemporalData | null;
    departure?: RttIndividualTemporalData | null;
  };
}

interface RttLocationResponse {
  services?: RttService[];
}

export interface RttClientConfig {
  rttBaseUrl: string;
  rttStationCode: string;
}

function directionAndBlock(
  service: RttService,
): { direction: Direction; block: RttIndividualTemporalData } | null {
  const arrival = service.temporalData?.arrival;
  if (arrival?.scheduleAdvertised) return { direction: 'arriving', block: arrival };

  const departure = service.temporalData?.departure;
  if (departure?.scheduleAdvertised) return { direction: 'departing', block: departure };

  return null;
}

export function mapRttServiceToRow(service: RttService): ScheduledServiceRow | null {
  const resolved = directionAndBlock(service);
  if (!resolved) return null;
  const { direction, block } = resolved;

  const scheduled_time = new Date(block.scheduleAdvertised!).toISOString();
  const service_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    new Date(scheduled_time),
  );
  const peak_period = computePeakPeriod(new Date(scheduled_time));
  const rtt_uid = service.scheduleMetadata?.uniqueIdentity ?? null;

  if (block.isCancelled) {
    return { service_date, direction, scheduled_time, peak_period, status: 'cancelled', rtt_uid };
  }

  if (block.realtimeActual) {
    const delay_minutes = block.realtimeAdvertisedLateness ?? 0;
    return {
      service_date,
      direction,
      scheduled_time,
      peak_period,
      status: delay_minutes > DELAY_THRESHOLD_MINUTES ? 'delayed' : 'on_time',
      observed_time: new Date(block.realtimeActual).toISOString(),
      delay_minutes,
      rtt_uid,
    };
  }

  return { service_date, direction, scheduled_time, peak_period, status: 'pending', rtt_uid };
}

async function fetchLocationWindow(
  config: RttClientConfig,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fromHhmm: string,
  toHhmm: string,
  fetchFn: typeof fetch,
): Promise<RttService[]> {
  const timeFrom = londonTimeToUtcIso(serviceDate, fromHhmm);
  const timeTo = londonTimeToUtcIso(serviceDate, toHhmm);
  const url = `${config.rttBaseUrl}/rtt/location?code=${config.rttStationCode}&timeFrom=${timeFrom}&timeTo=${timeTo}`;

  const request = (token: string) => fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });

  let token = await tokenProvider.getAccessToken();
  let response = await request(token);

  if (response.status === 401) {
    // The cached access token was rejected (e.g. it expired early, or was
    // revoked) — force a fresh one and retry exactly once before giving up.
    token = await tokenProvider.forceRefresh();
    response = await request(token);
  }

  if (response.status === 204) return [];
  if (!response.ok) {
    throw new Error(`RTT location request failed with status ${response.status}`);
  }

  const body = (await response.json()) as RttLocationResponse;
  return body.services ?? [];
}

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

  return [...morning, ...evening]
    .map(mapRttServiceToRow)
    .filter((row): row is ScheduledServiceRow => row !== null);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd poller && npx vitest run test/rttClient.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 6: Commit**

```bash
git add poller/src/rttClient.ts poller/test/rttClient.test.ts poller/test/fixtures/rttLocation.json
git commit -m "feat(poller): add RTT client mapping services to scheduled_services rows"
```

---

### Task 6: Force-resolve fallback (`forceResolve.ts`)

**Files:**
- Create: `poller/src/forceResolve.ts`
- Test: `poller/test/forceResolve.test.ts`

**Interfaces:**
- Consumes: `ScheduledServiceRow` from `types.ts` (Task 2).
- Produces: `applyForceResolveFallback(existingPendingRows: ScheduledServiceRow[], freshRows: ScheduledServiceRow[], now: Date): ScheduledServiceRow[]`.
- Used by: `index.ts` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `poller/test/forceResolve.test.ts`:

```typescript
// poller/test/forceResolve.test.ts
import { describe, it, expect } from 'vitest';
import { applyForceResolveFallback } from '../src/forceResolve.js';
import type { ScheduledServiceRow } from '../src/types.js';

function row(overrides: Partial<ScheduledServiceRow>): ScheduledServiceRow {
  return {
    id: 'row-1',
    service_date: '2026-07-31',
    direction: 'departing',
    scheduled_time: '2026-07-31T07:00:00.000Z',
    peak_period: 'am_peak',
    status: 'pending',
    ...overrides,
  };
}

describe('applyForceResolveFallback', () => {
  it('cancels a pending row missing from the fresh RTT rows once 30 minutes past its scheduled time', () => {
    const pendingRows = [row({ id: 'a' })];
    const now = new Date('2026-07-31T07:31:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, [], now);

    expect(resolved).toEqual([{ ...pendingRows[0], status: 'cancelled' }]);
  });

  it('leaves a pending row alone if it is still within the 30-minute grace period', () => {
    const pendingRows = [row({ id: 'a' })];
    const now = new Date('2026-07-31T07:20:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, [], now);

    expect(resolved).toEqual([]);
  });

  it('does not touch a pending row that RTT still reports, even past 30 minutes', () => {
    const pendingRows = [row({ id: 'a' })];
    const freshRows = [row({ id: undefined, status: 'pending' })];
    const now = new Date('2026-07-31T07:31:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, freshRows, now);

    expect(resolved).toEqual([]);
  });

  it('matches rows by direction and scheduled_time, not id', () => {
    const pendingRows = [
      row({ id: 'a', direction: 'arriving', scheduled_time: '2026-07-31T07:05:00.000Z' }),
    ];
    const freshRows = [
      row({
        id: undefined,
        direction: 'arriving',
        scheduled_time: '2026-07-31T07:05:00.000Z',
        status: 'on_time',
      }),
    ];
    const now = new Date('2026-07-31T07:40:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, freshRows, now);

    expect(resolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npx vitest run test/forceResolve.test.ts`
Expected: FAIL — `Cannot find module '../src/forceResolve.js'`.

- [ ] **Step 3: Implement `poller/src/forceResolve.ts`**

```typescript
// poller/src/forceResolve.ts
import type { ScheduledServiceRow } from './types.js';

const FORCE_RESOLVE_MS = 30 * 60 * 1000;

function rowKey(row: Pick<ScheduledServiceRow, 'direction' | 'scheduled_time'>): string {
  return `${row.direction}|${row.scheduled_time}`;
}

export function applyForceResolveFallback(
  existingPendingRows: ScheduledServiceRow[],
  freshRows: ScheduledServiceRow[],
  now: Date,
): ScheduledServiceRow[] {
  const freshKeys = new Set(freshRows.map(rowKey));
  const resolved: ScheduledServiceRow[] = [];

  for (const row of existingPendingRows) {
    if (freshKeys.has(rowKey(row))) continue;

    const timeSinceScheduled = now.getTime() - new Date(row.scheduled_time).getTime();
    if (timeSinceScheduled >= FORCE_RESOLVE_MS) {
      resolved.push({ ...row, status: 'cancelled' });
    }
  }

  return resolved;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npx vitest run test/forceResolve.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add poller/src/forceResolve.ts poller/test/forceResolve.test.ts
git commit -m "feat(poller): add 30-minute force-resolve fallback for RTT data gaps"
```

---

### Task 7: Rewrite `repository.ts`

**Files:**
- Modify: `poller/src/repository.ts`
- Modify: `poller/test/repository.test.ts`

**Interfaces:**
- Consumes: `ScheduledServiceRow` from `types.ts` (Task 2).
- Produces: `fetchPendingRows(client, serviceDate): Promise<ScheduledServiceRow[]>` (unchanged signature), `upsertScheduledServices(client, rows: ScheduledServiceRow[]): Promise<void>` (replaces `upsertRows`, `insertSeedRows`, `rowsExistForDate`, `fetchRecentlyResolvedRows`).
- Used by: `index.ts` (Task 8).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `poller/test/repository.test.ts`:

```typescript
// poller/test/repository.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchPendingRows, upsertScheduledServices } from '../src/repository.js';

function makeFakeClient(overrides: Record<string, any> = {}) {
  const eq2 = vi.fn().mockResolvedValue({ data: overrides.selectData ?? [], error: null });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const upsert = vi.fn().mockResolvedValue({ error: overrides.upsertError ?? null });
  const from = vi.fn().mockReturnValue({ select, upsert });
  return { client: { from } as any, from, select, eq1, eq2, upsert };
}

describe('fetchPendingRows', () => {
  it('queries scheduled_services filtered by service_date and status', async () => {
    const { client, from, eq1, eq2 } = makeFakeClient({ selectData: [{ id: 'a' }] });
    const rows = await fetchPendingRows(client, '2026-07-31');

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(eq1).toHaveBeenCalledWith('service_date', '2026-07-31');
    expect(eq2).toHaveBeenCalledWith('status', 'pending');
    expect(rows).toEqual([{ id: 'a' }]);
  });

  it('throws if the query returns an error', async () => {
    const eq2 = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const client = { from: vi.fn().mockReturnValue({ select }) } as any;

    await expect(fetchPendingRows(client, '2026-07-31')).rejects.toThrow(/boom/);
  });
});

describe('upsertScheduledServices', () => {
  it('does nothing for an empty array', async () => {
    const { client, upsert } = makeFakeClient();
    await upsertScheduledServices(client, []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts on the natural (service_date, direction, scheduled_time) key', async () => {
    const { client, upsert } = makeFakeClient();
    const rows = [
      {
        service_date: '2026-07-31',
        direction: 'arriving',
        scheduled_time: '2026-07-31T07:00:00.000Z',
        status: 'on_time',
      },
    ] as any;
    await upsertScheduledServices(client, rows);
    expect(upsert).toHaveBeenCalledWith(rows, { onConflict: 'service_date,direction,scheduled_time' });
  });

  it('throws if the upsert returns an error', async () => {
    const { client } = makeFakeClient({ upsertError: { message: 'boom' } });
    await expect(upsertScheduledServices(client, [{} as any])).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npx vitest run test/repository.test.ts`
Expected: FAIL — `upsertScheduledServices` is not exported from `repository.ts` yet.

- [ ] **Step 3: Replace `poller/src/repository.ts`**

```typescript
// poller/src/repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduledServiceRow } from './types.js';

export async function fetchPendingRows(
  client: SupabaseClient,
  serviceDate: string,
): Promise<ScheduledServiceRow[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('*')
    .eq('service_date', serviceDate)
    .eq('status', 'pending');

  if (error) throw new Error(`fetchPendingRows failed: ${error.message}`);
  return (data ?? []) as ScheduledServiceRow[];
}

export async function upsertScheduledServices(
  client: SupabaseClient,
  rows: ScheduledServiceRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .from('scheduled_services')
    .upsert(rows, { onConflict: 'service_date,direction,scheduled_time' });
  if (error) throw new Error(`upsertScheduledServices failed: ${error.message}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npx vitest run test/repository.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add poller/src/repository.ts poller/test/repository.test.ts
git commit -m "feat(poller): replace seed/matching repository functions with a single upsert"
```

---

### Task 8: Rewire `index.ts` to the RTT pipeline

**Files:**
- Modify: `poller/src/index.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 3), `createTokenProvider` (Task 4), `fetchTodayRows` (Task 5), `applyForceResolveFallback` (Task 6), `fetchPendingRows` / `upsertScheduledServices` (Task 7), `todayLondon` (existing).
- No new exports — this is the entry point.

There's no existing test file for `index.ts` (it's the orchestration entry point, verified via the manual dry-run in Task 9), so this task has no red/green cycle — just replace the file and confirm the full suite still passes.

- [ ] **Step 1: Replace `poller/src/index.ts`**

```typescript
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
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `cd poller && npm test`
Expected: PASS. (The old tests for deleted modules — `tflClient`, `barkingClient`, `direction`, `schedule`, `pollCycle` — still exist and still pass at this point, since Task 9 deletes them; they no longer matter for the running poller since nothing in `index.ts` imports those modules anymore.)

- [ ] **Step 3: Commit**

```bash
git add poller/src/index.ts
git commit -m "feat(poller): rewire poll loop to RTT — fetch, force-resolve fallback, upsert"
```

---

### Task 9: Remove obsolete files, update docs, final verification

**Files:**
- Delete: `poller/src/tflClient.ts`, `poller/src/barkingClient.ts`, `poller/src/direction.ts`, `poller/src/schedule.ts`, `poller/src/pollCycle.ts`
- Delete: `poller/schedule.json`
- Delete: `poller/test/tflClient.test.ts`, `poller/test/barkingClient.test.ts`, `poller/test/direction.test.ts`, `poller/test/schedule.test.ts`, `poller/test/pollCycle.test.ts`
- Delete: `poller/test/fixtures/arrivals.json`, `poller/test/fixtures/barkingArrivals.json`
- Modify: `poller/src/dateHelpers.ts` (remove `yesterdayLondon`, now unused)
- Modify: `poller/test/dateHelpers.test.ts` (remove the `yesterdayLondon` describe block)
- Modify: `poller/README.md`

- [ ] **Step 1: Confirm nothing still references the files about to be deleted**

Run: `cd poller && grep -rln "tflClient\|barkingClient\|from '\.\/direction\|from '\.\/schedule\.js\|schedule\.json\|pollCycle" src/ | grep -v -E "tflClient\.ts|barkingClient\.ts|direction\.ts|schedule\.ts|pollCycle\.ts"`
Expected: no output (only the files being deleted themselves reference each other; `index.ts`, rewritten in Task 8, no longer does).

- [ ] **Step 2: Delete the obsolete source and test files**

```bash
cd poller
git rm src/tflClient.ts src/barkingClient.ts src/direction.ts src/schedule.ts src/pollCycle.ts
git rm schedule.json
git rm test/tflClient.test.ts test/barkingClient.test.ts test/direction.test.ts test/schedule.test.ts test/pollCycle.test.ts
git rm test/fixtures/arrivals.json test/fixtures/barkingArrivals.json
```

- [ ] **Step 3: Remove `yesterdayLondon` from `dateHelpers.ts`**

In `poller/src/dateHelpers.ts`, delete the `yesterdayLondon` function and its preceding comment block, leaving:

```typescript
// poller/src/dateHelpers.ts
export function todayLondon(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function londonUtcOffsetHoursForDate(serviceDate: string): number {
  // Anchor at local noon so we never straddle a day boundary or a DST
  // transition (which happen at 01:00/02:00 local, not noon).
  const noonUtcGuess = new Date(`${serviceDate}T12:00:00.000Z`);
  const londonHourAtNoon = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(noonUtcGuess),
  );
  return londonHourAtNoon - 12;
}

export function londonTimeToUtcIso(serviceDate: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);
  const offsetHours = londonUtcOffsetHoursForDate(serviceDate);
  const [year, month, day] = serviceDate.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0));
  return utc.toISOString();
}
```

- [ ] **Step 4: Update `dateHelpers.test.ts` to match**

In `poller/test/dateHelpers.test.ts`:
- Change the import line to: `import { todayLondon, londonTimeToUtcIso } from '../src/dateHelpers.js';`
- Delete the entire `describe('yesterdayLondon', ...)` block.

The file should now contain only the `describe('todayLondon', ...)` and `describe('londonTimeToUtcIso', ...)` blocks from Task 1.

- [ ] **Step 5: Update `poller/README.md`**

Replace the "Setup" section's steps 2–3 and the entire "Updating the schedule" section. The full updated file:

```markdown
# Barking Riverside Poller

Polls the Realtime Trains (RTT) next-generation API for services calling at
Barking Riverside station (CRS code `BGV`), and records on-time/delayed/
cancelled outcomes to Supabase.

## Setup

1. Apply the database migrations to your Supabase project: open the SQL
   Editor in the Supabase dashboard and run, in order, `0001_init.sql`,
   `0002_set_updated_at_trigger.sql`, and `0003_rtt_migration.sql` (repo root,
   `supabase/migrations/`) — or apply them from the repo root with the
   Supabase CLI, e.g. `supabase db push`. The poller will fail on its first
   cycle without the `scheduled_services` table and its RTT-shaped columns.
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (from your Supabase project's API settings),
   and `RTT_REFRESH_TOKEN` (from your RTT next-generation API account —
   sign up at https://api-portal.rtt.io).

There's no schedule file to maintain: RTT's `/rtt/location` response for
Barking Riverside is itself the schedule, sourced from the real Network Rail
timetable, so genuine timetable changes are picked up automatically.

## Running locally

    npm install
    npm start

Set `DRY_RUN=true` to log intended changes without writing to Supabase.

## Running in Docker (homelab)

    docker compose up -d --build

Check logs with `docker compose logs -f`.

## Running tests

    npm test
```

- [ ] **Step 6: Run the full test suite**

Run: `cd poller && npm test`
Expected: PASS — every remaining test file passes (`config`, `dateHelpers`, `peakPeriod`, `rttAuth`, `rttClient`, `forceResolve`, `repository`).

- [ ] **Step 7: Type-check the whole project**

Run: `cd poller && npx tsc --noEmit`
Expected: no errors. (This is the first point in the plan where a full-project type-check is run — it confirms there's no leftover reference to a removed field or deleted module anywhere.)

- [ ] **Step 8: Dry-run against the real RTT API**

With a real `RTT_REFRESH_TOKEN` in `poller/.env`:

Run: `cd poller && DRY_RUN=true npm start`
Expected: logs show `Starting poller (dry run: true, ...)` followed by a `[dry-run] would upsert N rows` line within one poll interval, with no thrown errors. Inspect the logged rows to confirm `direction`, `status`, `scheduled_time`, and `rtt_uid` look correct for real Barking Riverside services. Stop the process (Ctrl+C) once confirmed — this step is manual verification, not something to automate into the test suite.

- [ ] **Step 9: Commit**

```bash
git add poller/src/dateHelpers.ts poller/test/dateHelpers.test.ts poller/README.md
git commit -m "chore(poller): remove TfL/schedule.json pipeline, now superseded by RTT"
```
