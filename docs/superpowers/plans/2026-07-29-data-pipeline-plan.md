# Data Pipeline (Supabase + Poller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Supabase schema and a Dockerized homelab poller that polls TfL's live Arrivals API for Barking Riverside, matches it against a fixed manually-maintained schedule, and records on-time/delayed/cancelled outcomes.

**Architecture:** A Node/TypeScript poller runs continuously in Docker, seeding each day's expected services from a git-versioned `schedule.json`, then every 30–60s polling TfL's Arrivals endpoint, matching live predictions to scheduled rows by direction + nearest time, and writing status back to Supabase Postgres via the service-role key.

**Tech Stack:** TypeScript, Node 20+, `tsx` (run TS directly, no build step), `vitest` (testing), `@supabase/supabase-js`, native `fetch`, Docker.

This plan covers the **data pipeline only** (Supabase schema + poller). The dashboard frontend is a separate plan (`2026-07-29-dashboard-plan.md`) that reads from the `scheduled_services` table this plan creates.

## Global Constraints

- Free to run: no paid services. Supabase free tier project. Poller runs in the user's homelab via Docker — never on Vercel.
- TfL Unified API requires no auth for the endpoints used here (`/StopPoint/{id}/Arrivals`).
- All day-boundary and peak-period logic must use `Europe/London` wall-clock time via `Intl.DateTimeFormat`, never the host machine's local time or raw UTC — the poller may run on a server in any timezone.
- Station/line constants (verified live during design): TfL StopPoint id `910GBARKRIV`, line id `suffragette`, destination NaptanIds `910GGOSPLOK` (Gospel Oak) and `910GBARKRIV` (Barking Riverside terminus).
- No live TfL Timetable API exists for this line (confirmed 404) — schedule data comes only from the git-versioned `poller/schedule.json`, maintained by the user.
- Spec reference: `docs/superpowers/specs/2026-07-29-train-tracker-phase1-design.md`.

---

### Task 1: Supabase project + schema migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces: the `scheduled_services` table that every later task (poller writes, dashboard reads) depends on. Exact columns below are the contract.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/0001_init.sql

create table scheduled_services (
  id                        uuid primary key default gen_random_uuid(),
  service_date              date not null,
  direction                 text not null check (direction in ('departing', 'arriving')),
  scheduled_time            timestamptz not null,
  peak_period               text not null check (peak_period in ('am_peak', 'pm_peak', 'off_peak')),
  status                    text not null default 'pending'
                              check (status in ('pending', 'on_time', 'delayed', 'cancelled')),
  observed_time             timestamptz,
  delay_minutes             integer,
  vehicle_id                text,
  last_seen_time_to_station integer,
  last_seen_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (service_date, direction, scheduled_time)
);

create index scheduled_services_date_peak_idx on scheduled_services (service_date, peak_period);
create index scheduled_services_status_idx on scheduled_services (status);

alter table scheduled_services enable row level security;

create policy "anon can read scheduled_services"
  on scheduled_services
  for select
  to anon
  using (true);

-- No policy is created for insert/update/delete for anon: RLS defaults to
-- deny, so the anon key can never write. The service_role key used by the
-- poller bypasses RLS entirely (Supabase default), so it needs no policy.
```

`last_seen_time_to_station` / `last_seen_at` are poller bookkeeping columns (not used by the dashboard) that let the poll cycle detect when a matched train has actually arrived — see Task 6.

- [ ] **Step 2: Create the Supabase project**

Go to https://supabase.com/dashboard, create a new free-tier project (any name/region, e.g. `barking-riverside-tracker`). Note the **Project URL**, **anon public key**, and **service_role key** from Project Settings → API — you'll need all three (anon key is for the dashboard plan later; service_role and URL are needed now).

- [ ] **Step 3: Run the migration**

In the Supabase dashboard, open the SQL Editor, paste the full contents of `supabase/migrations/0001_init.sql`, and run it.

- [ ] **Step 4: Verify**

Still in the SQL Editor, run:

```sql
insert into scheduled_services (service_date, direction, scheduled_time, peak_period)
values (current_date, 'departing', now(), 'am_peak');

select * from scheduled_services;

delete from scheduled_services;
```

Expected: the insert and select succeed, showing one row with `status = 'pending'` and `id`/`created_at`/`updated_at` auto-populated. Clean up with the delete so the table is empty before the poller runs.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "Add scheduled_services schema with RLS (anon read-only)"
```

---

### Task 2: Poller project scaffold

**Files:**
- Create: `poller/package.json`
- Create: `poller/tsconfig.json`
- Create: `poller/vitest.config.ts`
- Create: `poller/.env.example`
- Create: `poller/.gitignore`
- Create: `poller/src/config.ts`
- Test: `poller/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(): Config` where
  ```ts
  interface Config {
    tflStopPointId: string;
    tflLineId: string;
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    pollIntervalMs: number;
  }
  ```
  Later tasks import `loadConfig` from `./config` to get these values.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "barking-riverside-poller",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "tsx": "^4.19.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write .env.example and .gitignore**

`poller/.env.example`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
POLL_INTERVAL_MS=45000
```

`poller/.gitignore`:
```
node_modules/
dist/
.env
```

- [ ] **Step 5: Write the failing test for config.ts**

```ts
// poller/test/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    delete process.env.POLL_INTERVAL_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads required values from env and applies defaults', () => {
    const config = loadConfig();
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.supabaseServiceRoleKey).toBe('test-key');
    expect(config.tflStopPointId).toBe('910GBARKRIV');
    expect(config.tflLineId).toBe('suffragette');
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
});
```

- [ ] **Step 6: Install dependencies and run test to verify it fails**

Run: `cd poller && npm install && npm test`
Expected: FAIL — `../src/config.js` does not exist.

- [ ] **Step 7: Implement config.ts**

```ts
// poller/src/config.ts

export interface Config {
  tflStopPointId: string;
  tflLineId: string;
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
    tflStopPointId: '910GBARKRIV',
    tflLineId: 'suffragette',
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalMs: process.env.POLL_INTERVAL_MS
      ? Number(process.env.POLL_INTERVAL_MS)
      : 45000,
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd poller && npm test`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add poller/package.json poller/tsconfig.json poller/vitest.config.ts \
  poller/.env.example poller/.gitignore poller/src/config.ts poller/test/config.test.ts \
  poller/package-lock.json
git commit -m "Scaffold poller project with env-based config loader"
```

---

### Task 3: Peak period computation

**Files:**
- Create: `poller/src/peakPeriod.ts`
- Test: `poller/test/peakPeriod.test.ts`

**Interfaces:**
- Produces: `computePeakPeriod(date: Date): 'am_peak' | 'pm_peak' | 'off_peak'`, used by Task 5 (seed builder).

- [ ] **Step 1: Write the failing tests**

Reference dates (verified): `2026-01-05` is a Monday and `2026-01-03` is a Saturday, both in GMT (UTC+0, winter). `2026-07-29` is a Wednesday in BST (UTC+1, summer) — used to confirm DST handling.

```ts
// poller/test/peakPeriod.test.ts
import { describe, it, expect } from 'vitest';
import { computePeakPeriod } from '../src/peakPeriod.js';

describe('computePeakPeriod', () => {
  it('is am_peak at 07:00 London time on a winter weekday', () => {
    // 2026-01-05 is a Monday; GMT = UTC+0, so 07:00 London = 07:00 UTC
    expect(computePeakPeriod(new Date('2026-01-05T07:00:00Z'))).toBe('am_peak');
  });

  it('is off_peak at 07:00 London time on a winter Saturday', () => {
    // 2026-01-03 is a Saturday
    expect(computePeakPeriod(new Date('2026-01-03T07:00:00Z'))).toBe('off_peak');
  });

  it('is pm_peak at 18:30 London time on a summer weekday (BST)', () => {
    // 2026-07-29 is a Wednesday; BST = UTC+1, so 18:30 London = 17:30 UTC
    expect(computePeakPeriod(new Date('2026-07-29T17:30:00Z'))).toBe('pm_peak');
  });

  it('is am_peak at 07:00 London time on a summer weekday (BST)', () => {
    // 07:00 London (BST) = 06:00 UTC
    expect(computePeakPeriod(new Date('2026-07-29T06:00:00Z'))).toBe('am_peak');
  });

  it('is off_peak at midday on a weekday', () => {
    expect(computePeakPeriod(new Date('2026-07-29T11:00:00Z'))).toBe('off_peak');
  });

  it('is off_peak exactly at the am_peak boundary end (09:30)', () => {
    // 09:30 London (BST) = 08:30 UTC — end boundary is exclusive
    expect(computePeakPeriod(new Date('2026-07-29T08:30:00Z'))).toBe('off_peak');
  });

  it('is am_peak exactly at the am_peak boundary start (06:30)', () => {
    // 06:30 London (BST) = 05:30 UTC — start boundary is inclusive
    expect(computePeakPeriod(new Date('2026-07-29T05:30:00Z'))).toBe('am_peak');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL — `../src/peakPeriod.js` does not exist.

- [ ] **Step 3: Implement peakPeriod.ts**

```ts
// poller/src/peakPeriod.ts

export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';

const LONDON_TZ = 'Europe/London';
const AM_START_MIN = 6 * 60 + 30;  // 06:30
const AM_END_MIN = 9 * 60 + 30;    // 09:30
const PM_START_MIN = 16 * 60;      // 16:00
const PM_END_MIN = 19 * 60;        // 19:00
const WEEKEND_DAYS = new Set(['Sat', 'Sun']);

export function computePeakPeriod(date: Date): PeakPeriod {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')!.value;
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  const minute = Number(parts.find((p) => p.type === 'minute')!.value);
  const minutesSinceMidnight = hour * 60 + minute;

  if (WEEKEND_DAYS.has(weekday)) {
    return 'off_peak';
  }

  if (minutesSinceMidnight >= AM_START_MIN && minutesSinceMidnight < AM_END_MIN) {
    return 'am_peak';
  }

  if (minutesSinceMidnight >= PM_START_MIN && minutesSinceMidnight < PM_END_MIN) {
    return 'pm_peak';
  }

  return 'off_peak';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add poller/src/peakPeriod.ts poller/test/peakPeriod.test.ts
git commit -m "Add London-timezone-aware peak period computation"
```

---

### Task 4: Direction detection from TfL destination

**Files:**
- Create: `poller/src/direction.ts`
- Test: `poller/test/direction.test.ts`

**Interfaces:**
- Produces: `directionFromDestinationNaptanId(naptanId: string): 'departing' | 'arriving' | null`, used by Task 6 (TfL client / poll cycle).

- [ ] **Step 1: Write the failing tests**

```ts
// poller/test/direction.test.ts
import { describe, it, expect } from 'vitest';
import { directionFromDestinationNaptanId } from '../src/direction.js';

describe('directionFromDestinationNaptanId', () => {
  it('maps Gospel Oak destination to departing', () => {
    expect(directionFromDestinationNaptanId('910GGOSPLOK')).toBe('departing');
  });

  it('maps Barking Riverside destination to arriving (terminating service)', () => {
    expect(directionFromDestinationNaptanId('910GBARKRIV')).toBe('arriving');
  });

  it('returns null for an unrecognised destination', () => {
    expect(directionFromDestinationNaptanId('910GSOMEOTHER')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL — `../src/direction.js` does not exist.

- [ ] **Step 3: Implement direction.ts**

```ts
// poller/src/direction.ts

export type Direction = 'departing' | 'arriving';

const GOSPEL_OAK_NAPTAN_ID = '910GGOSPLOK';
const BARKING_RIVERSIDE_NAPTAN_ID = '910GBARKRIV';

export function directionFromDestinationNaptanId(naptanId: string): Direction | null {
  if (naptanId === GOSPEL_OAK_NAPTAN_ID) return 'departing';
  if (naptanId === BARKING_RIVERSIDE_NAPTAN_ID) return 'arriving';
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add poller/src/direction.ts poller/test/direction.test.ts
git commit -m "Add direction detection from TfL destinationNaptanId"
```

---

### Task 5: Fixed schedule config + daily seed row builder

**Files:**
- Create: `poller/schedule.json`
- Create: `poller/src/types.ts`
- Create: `poller/src/schedule.ts`
- Test: `poller/test/schedule.test.ts`

**Interfaces:**
- Consumes: `computePeakPeriod` from Task 3.
- Produces:
  ```ts
  interface ScheduledServiceRow {
    service_date: string;       // 'YYYY-MM-DD'
    direction: 'departing' | 'arriving';
    scheduled_time: string;     // ISO datetime
    peak_period: 'am_peak' | 'pm_peak' | 'off_peak';
    status: 'pending';
  }
  function buildSeedRows(schedule: ScheduleConfig, serviceDate: string): ScheduledServiceRow[]
  ```
  Used by Task 7 (poll cycle orchestration) to seed each day.

- [ ] **Step 1: Create schedule.json with placeholder structure**

```json
{
  "effective_from": "2026-07-29",
  "weekday": {
    "departing": [],
    "arriving": []
  },
  "saturday": {
    "departing": [],
    "arriving": []
  },
  "sunday": {
    "departing": [],
    "arriving": []
  }
}
```

- [ ] **Step 2: Populate schedule.json with the real published timetable**

This step must be done by you (the project owner), not guessed by an
implementer — it's real-world data, not code. Look up Barking Riverside's
current published timetable (e.g. via nationalrail.co.uk's journey planner
for BGV, or the TfL website's Suffragette line page) and fill in every
scheduled `"HH:MM"` departure time (services starting at Barking Riverside,
heading to Gospel Oak) and arrival time (services terminating at Barking
Riverside, having come from Gospel Oak) for a full weekday, a full Saturday,
and a full Sunday. Update `effective_from` to today's date once filled in.

- [ ] **Step 3: Write types.ts**

```ts
// poller/src/types.ts

export type Direction = 'departing' | 'arriving';
export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';
export type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled';

export interface DaySchedule {
  departing: string[]; // "HH:MM" in London local time
  arriving: string[];
}

export interface ScheduleConfig {
  effective_from: string;
  weekday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

export interface ScheduledServiceRow {
  id?: string;
  service_date: string;
  direction: Direction;
  scheduled_time: string;
  peak_period: PeakPeriod;
  status: ServiceStatus;
  observed_time?: string | null;
  delay_minutes?: number | null;
  vehicle_id?: string | null;
  last_seen_time_to_station?: number | null;
  last_seen_at?: string | null;
}
```

- [ ] **Step 4: Write the failing tests for schedule.ts**

```ts
// poller/test/schedule.test.ts
import { describe, it, expect } from 'vitest';
import { buildSeedRows } from '../src/schedule.js';
import type { ScheduleConfig } from '../src/types.js';

const testSchedule: ScheduleConfig = {
  effective_from: '2026-01-01',
  weekday: { departing: ['07:03', '18:15'], arriving: ['07:20'] },
  saturday: { departing: ['09:00'], arriving: [] },
  sunday: { departing: [], arriving: [] },
};

describe('buildSeedRows', () => {
  it('builds one row per scheduled time for a weekday, with correct peak_period', () => {
    // 2026-01-05 is a Monday (winter/GMT)
    const rows = buildSeedRows(testSchedule, '2026-01-05');

    expect(rows).toHaveLength(3);

    const departure1 = rows.find(
      (r) => r.direction === 'departing' && r.scheduled_time === '2026-01-05T07:03:00.000Z',
    );
    expect(departure1?.peak_period).toBe('am_peak');
    expect(departure1?.status).toBe('pending');
    expect(departure1?.service_date).toBe('2026-01-05');

    const departure2 = rows.find(
      (r) => r.direction === 'departing' && r.scheduled_time === '2026-01-05T18:15:00.000Z',
    );
    expect(departure2?.peak_period).toBe('pm_peak');

    const arrival1 = rows.find((r) => r.direction === 'arriving');
    expect(arrival1?.scheduled_time).toBe('2026-01-05T07:20:00.000Z');
    expect(arrival1?.peak_period).toBe('am_peak');
  });

  it('uses the saturday schedule for a Saturday date', () => {
    // 2026-01-03 is a Saturday
    const rows = buildSeedRows(testSchedule, '2026-01-03');
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_time).toBe('2026-01-03T09:00:00.000Z');
    expect(rows[0].peak_period).toBe('off_peak');
  });

  it('uses the sunday schedule (empty) for a Sunday date', () => {
    // 2026-01-04 is a Sunday
    const rows = buildSeedRows(testSchedule, '2026-01-04');
    expect(rows).toHaveLength(0);
  });

  it('converts London local HH:MM to correct UTC instant across BST', () => {
    const bstSchedule: ScheduleConfig = {
      effective_from: '2026-01-01',
      weekday: { departing: ['07:00'], arriving: [] },
      saturday: { departing: [], arriving: [] },
      sunday: { departing: [], arriving: [] },
    };
    // 2026-07-29 is a Wednesday, BST (UTC+1): 07:00 London = 06:00 UTC
    const rows = buildSeedRows(bstSchedule, '2026-07-29');
    expect(rows[0].scheduled_time).toBe('2026-07-29T06:00:00.000Z');
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL — `../src/schedule.js` does not exist.

- [ ] **Step 6: Implement schedule.ts**

```ts
// poller/src/schedule.ts
import { computePeakPeriod } from './peakPeriod.js';
import type { DaySchedule, Direction, ScheduleConfig, ScheduledServiceRow } from './types.js';

function dayTypeFor(serviceDate: string): 'weekday' | 'saturday' | 'sunday' {
  // serviceDate is 'YYYY-MM-DD'; interpret as a London calendar date (no
  // time-of-day ambiguity since we only need the day of week).
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
  }).format(new Date(`${serviceDate}T12:00:00Z`));

  if (weekday === 'Sat') return 'saturday';
  if (weekday === 'Sun') return 'sunday';
  return 'weekday';
}

function londonTimeToUtcIso(serviceDate: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);

  // Find the UTC instant whose Europe/London wall-clock time matches
  // serviceDate + hh:mm, by starting from a UTC guess and correcting for
  // the actual London offset at that date (handles BST/GMT correctly).
  const naiveUtcGuess = new Date(`${serviceDate}T${hhmm}:00.000Z`);
  const londonPartsAtGuess = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(naiveUtcGuess);
  const londonHourAtGuess = Number(londonPartsAtGuess);
  const offsetHours = londonHourAtGuess - hour;

  const corrected = new Date(naiveUtcGuess.getTime() - offsetHours * 60 * 60 * 1000);
  return corrected.toISOString();
}

function rowsForDirection(
  serviceDate: string,
  direction: Direction,
  times: string[],
): ScheduledServiceRow[] {
  return times.map((hhmm) => {
    const scheduled_time = londonTimeToUtcIso(serviceDate, hhmm);
    return {
      service_date: serviceDate,
      direction,
      scheduled_time,
      peak_period: computePeakPeriod(new Date(scheduled_time)),
      status: 'pending' as const,
    };
  });
}

export function buildSeedRows(schedule: ScheduleConfig, serviceDate: string): ScheduledServiceRow[] {
  const dayType = dayTypeFor(serviceDate);
  const daySchedule: DaySchedule = schedule[dayType];

  return [
    ...rowsForDirection(serviceDate, 'departing', daySchedule.departing),
    ...rowsForDirection(serviceDate, 'arriving', daySchedule.arriving),
  ];
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: PASS (4 tests)

- [ ] **Step 8: Commit**

```bash
git add poller/schedule.json poller/src/types.ts poller/src/schedule.ts poller/test/schedule.test.ts
git commit -m "Add fixed schedule config and daily seed row builder"
```

---

### Task 6: TfL Arrivals client

**Files:**
- Create: `poller/src/tflClient.ts`
- Test: `poller/test/tflClient.test.ts`
- Test fixture: `poller/test/fixtures/arrivals.json`

**Interfaces:**
- Consumes: `Config` from Task 2 (`tflStopPointId`).
- Produces:
  ```ts
  interface TflPrediction {
    vehicleId: string;
    destinationNaptanId: string;
    timeToStation: number;   // seconds
    expectedArrival: string; // ISO datetime
  }
  async function fetchArrivals(stopPointId: string, fetchFn?: typeof fetch): Promise<TflPrediction[]>
  ```
  Used by Task 7 (poll cycle).

- [ ] **Step 1: Create the fixture from verified real TfL data**

```json
// poller/test/fixtures/arrivals.json
[
  {
    "$type": "Tfl.Api.Presentation.Entities.Prediction, Tfl.Api.Presentation.Entities",
    "id": "-1397794352",
    "operationType": 1,
    "vehicleId": "202607296734316",
    "naptanId": "910GBARKRIV",
    "stationName": "Barking Riverside",
    "lineId": "suffragette",
    "lineName": "Suffragette",
    "platformName": "Platform 1",
    "direction": "inbound",
    "bearing": "",
    "destinationNaptanId": "910GGOSPLOK",
    "destinationName": "Gospel Oak Rail Station",
    "timestamp": "2026-07-29T16:21:15.094335Z",
    "timeToStation": 60,
    "currentLocation": "",
    "towards": "",
    "expectedArrival": "2026-07-29T16:21:16Z",
    "timeToLive": "2026-07-29T17:02:16Z",
    "modeName": "overground"
  },
  {
    "$type": "Tfl.Api.Presentation.Entities.Prediction, Tfl.Api.Presentation.Entities",
    "id": "-1055273539",
    "operationType": 1,
    "vehicleId": "202607297107111",
    "naptanId": "910GBARKRIV",
    "stationName": "Barking Riverside",
    "lineId": "suffragette",
    "lineName": "Suffragette",
    "platformName": "Platform 2",
    "direction": "outbound",
    "destinationNaptanId": "910GBARKRIV",
    "destinationName": "Barking Riverside",
    "timestamp": "2026-07-29T16:21:15.094335Z",
    "timeToStation": 1393,
    "expectedArrival": "2026-07-29T16:44:29Z",
    "modeName": "overground"
  }
]
```

(First object is captured verbatim from a live call made during design; second
is adapted from a second live sample to represent an `arriving` — i.e.
terminating — service.)

- [ ] **Step 2: Write the failing tests**

```ts
// poller/test/tflClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchArrivals } from '../src/tflClient.js';
import fixture from './fixtures/arrivals.json' with { type: 'json' };

describe('fetchArrivals', () => {
  it('fetches the correct URL and maps the response to TflPrediction[]', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const predictions = await fetchArrivals('910GBARKRIV', mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.tfl.gov.uk/StopPoint/910GBARKRIV/Arrivals',
    );
    expect(predictions).toEqual([
      {
        vehicleId: '202607296734316',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 60,
        expectedArrival: '2026-07-29T16:21:16Z',
      },
      {
        vehicleId: '202607297107111',
        destinationNaptanId: '910GBARKRIV',
        timeToStation: 1393,
        expectedArrival: '2026-07-29T16:44:29Z',
      },
    ]);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(
      fetchArrivals('910GBARKRIV', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL — `../src/tflClient.js` does not exist.

- [ ] **Step 4: Implement tflClient.ts**

```ts
// poller/src/tflClient.ts

export interface TflPrediction {
  vehicleId: string;
  destinationNaptanId: string;
  timeToStation: number;
  expectedArrival: string;
}

interface RawTflPrediction {
  vehicleId: string;
  destinationNaptanId: string;
  timeToStation: number;
  expectedArrival: string;
}

export async function fetchArrivals(
  stopPointId: string,
  fetchFn: typeof fetch = fetch,
): Promise<TflPrediction[]> {
  const url = `https://api.tfl.gov.uk/StopPoint/${stopPointId}/Arrivals`;
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(`TfL Arrivals request failed with status ${response.status}`);
  }

  const raw = (await response.json()) as RawTflPrediction[];

  return raw.map((p) => ({
    vehicleId: p.vehicleId,
    destinationNaptanId: p.destinationNaptanId,
    timeToStation: p.timeToStation,
    expectedArrival: p.expectedArrival,
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add poller/src/tflClient.ts poller/test/tflClient.test.ts poller/test/fixtures/arrivals.json
git commit -m "Add TfL Arrivals client with real-response-shaped fixture"
```

---

### Task 7: Poll cycle core logic (matching, arrival resolution, cancellation sweep)

This is the heart of the poller — a pure function so the tricky logic is
fully unit-testable without any network or database dependency.

**Files:**
- Create: `poller/src/pollCycle.ts`
- Test: `poller/test/pollCycle.test.ts`

**Interfaces:**
- Consumes: `ScheduledServiceRow`, `Direction` from Task 5's `types.ts`; `TflPrediction` from Task 6; `directionFromDestinationNaptanId` from Task 4.
- Produces:
  ```ts
  function runPollCycle(
    pendingRows: ScheduledServiceRow[],
    predictions: TflPrediction[],
    now: Date,
  ): ScheduledServiceRow[]  // only rows that changed
  ```
  Used by Task 8 (orchestration) to compute what to upsert after each poll.

- [ ] **Step 1: Write the failing tests**

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
    direction: 'departing',
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

describe('runPollCycle', () => {
  it('matches an unmatched prediction to the nearest pending row of the same direction', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GGOSPLOK', // -> departing
        timeToStation: 600,
        expectedArrival: '2026-07-29T07:02:00.000Z',
      },
    ];

    const changed = runPollCycle(rows, predictions, new Date('2026-07-29T06:52:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('a');
    expect(changed[0].vehicle_id).toBe('veh-1');
    expect(changed[0].status).toBe('pending');
    expect(changed[0].last_seen_time_to_station).toBe(600);
  });

  it('does not match a prediction more than 10 minutes from any pending scheduled_time', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 600,
        expectedArrival: '2026-07-29T07:20:00.000Z', // 20 min away, out of tolerance
      },
    ];

    const changed = runPollCycle(rows, predictions, new Date('2026-07-29T06:52:00.000Z'));
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
    // observed_time is estimated by projecting the last known countdown
    // forward (last_seen_at + last_seen_time_to_station), not just using
    // last_seen_at raw — 07:00:30 + 45s = 07:01:15.
    const changed = runPollCycle(rows, [], new Date('2026-07-29T07:02:00.000Z'));

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
    // observed_time = 07:05:00 + 30s = 07:05:30 -> 5.5 min late, rounds to 6
    const changed = runPollCycle(rows, [], new Date('2026-07-29T07:06:00.000Z'));

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
    // still present, further out
    const predictions: TflPrediction[] = [
      {
        vehicleId: 'veh-1',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 460,
        expectedArrival: '2026-07-29T07:00:00.000Z',
      },
    ];
    const changed = runPollCycle(rows, predictions, new Date('2026-07-29T06:53:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe('pending');
    expect(changed[0].last_seen_time_to_station).toBe(460);
  });

  it('marks an unmatched pending row as cancelled after the 15 minute grace period', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const changed = runPollCycle(rows, [], new Date('2026-07-29T07:16:00.000Z'));

    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe('cancelled');
  });

  it('does not cancel an unmatched pending row still within the grace period', () => {
    const rows = [row({ id: 'a', scheduled_time: '2026-07-29T07:00:00.000Z' })];
    const changed = runPollCycle(rows, [], new Date('2026-07-29T07:10:00.000Z'));

    expect(changed).toHaveLength(0);
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
    // observed_time is projected forward (06:58:00 + 400s = 07:04:40), not
    // taken as the raw last-seen timestamp — otherwise this would nonsensically
    // resolve to a negative delay (arriving before its own scheduled time).
    const changed = runPollCycle(rows, [], new Date('2026-07-29T07:31:00.000Z'));

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
    const changed = runPollCycle(rows, predictions, new Date('2026-07-29T06:52:00.000Z'));
    expect(changed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL — `../src/pollCycle.js` does not exist.

- [ ] **Step 3: Implement pollCycle.ts**

```ts
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

    const alreadyMatchedRow = pendingRows.find((r) => r.vehicle_id === prediction.vehicleId);
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

    const candidates = pendingRows.filter(
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add poller/src/pollCycle.ts poller/test/pollCycle.test.ts
git commit -m "Add poll cycle: matching, arrival resolution, cancellation sweep"
```

---

### Task 8: Supabase data access layer

**Files:**
- Create: `poller/src/supabaseClient.ts`
- Create: `poller/src/repository.ts`
- Test: `poller/test/repository.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 2, `ScheduledServiceRow` from Task 5's `types.ts`.
- Produces:
  ```ts
  function createSupabaseClient(config: Config): SupabaseClient
  async function fetchPendingRows(client: SupabaseClient, serviceDate: string): Promise<ScheduledServiceRow[]>
  async function upsertRows(client: SupabaseClient, rows: ScheduledServiceRow[]): Promise<void>
  async function insertSeedRows(client: SupabaseClient, rows: ScheduledServiceRow[]): Promise<void>
  async function rowsExistForDate(client: SupabaseClient, serviceDate: string): Promise<boolean>
  ```
  Used by Task 9 (orchestration). `rowsExistForDate` is deliberately not
  filtered by status — it's used to decide whether a day has been seeded at
  all, and must still return `true` late in the day when every row has
  already resolved to `on_time`/`delayed`/`cancelled` (otherwise a poller
  restart would try to reseed and hit the `unique` constraint).

- [ ] **Step 1: Implement supabaseClient.ts**

```ts
// poller/src/supabaseClient.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from './config.js';

export function createSupabaseClient(config: Config): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
}

export type { SupabaseClient };
```

- [ ] **Step 2: Write the failing tests for repository.ts**

These test against a fake Supabase client object (matching the small surface
this module actually calls), since a real integration test would need a live
Supabase project — full end-to-end verification happens in Task 10's dry run
instead.

```ts
// poller/test/repository.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchPendingRows, upsertRows, insertSeedRows, rowsExistForDate } from '../src/repository.js';

function makeFakeClient(overrides: Record<string, any> = {}) {
  const eq2 = vi.fn().mockResolvedValue({ data: overrides.selectData ?? [], error: null });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const upsert = vi.fn().mockResolvedValue({ error: overrides.upsertError ?? null });
  const insert = vi.fn().mockResolvedValue({ error: overrides.insertError ?? null });
  const from = vi.fn().mockReturnValue({ select, upsert, insert });
  return { client: { from } as any, from, select, eq1, eq2, upsert, insert };
}

describe('fetchPendingRows', () => {
  it('queries scheduled_services filtered by service_date and status', async () => {
    const { client, from, eq1, eq2 } = makeFakeClient({ selectData: [{ id: 'a' }] });
    const rows = await fetchPendingRows(client, '2026-07-29');

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(eq1).toHaveBeenCalledWith('service_date', '2026-07-29');
    expect(eq2).toHaveBeenCalledWith('status', 'pending');
    expect(rows).toEqual([{ id: 'a' }]);
  });
});

describe('upsertRows', () => {
  it('does nothing for an empty array', async () => {
    const { client, upsert } = makeFakeClient();
    await upsertRows(client, []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('calls upsert with the given rows on the conflict key', async () => {
    const { client, upsert } = makeFakeClient();
    const rows = [{ id: 'a', status: 'on_time' }] as any;
    await upsertRows(client, rows);
    expect(upsert).toHaveBeenCalledWith(rows, { onConflict: 'id' });
  });

  it('throws if the upsert returns an error', async () => {
    const { client } = makeFakeClient({ upsertError: { message: 'boom' } });
    await expect(upsertRows(client, [{ id: 'a' } as any])).rejects.toThrow(/boom/);
  });
});

describe('insertSeedRows', () => {
  it('does nothing for an empty array', async () => {
    const { client, insert } = makeFakeClient();
    await insertSeedRows(client, []);
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts the given rows', async () => {
    const { client, insert } = makeFakeClient();
    const rows = [{ service_date: '2026-07-29' }] as any;
    await insertSeedRows(client, rows);
    expect(insert).toHaveBeenCalledWith(rows);
  });

  it('throws if the insert returns an error', async () => {
    const { client } = makeFakeClient({ insertError: { message: 'dup' } });
    await expect(insertSeedRows(client, [{} as any])).rejects.toThrow(/dup/);
  });
});

describe('rowsExistForDate', () => {
  function makeFakeClientForExistence(rows: any[]) {
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { client: { from } as any, from, select, eq };
  }

  it('returns false when no rows exist for the date, regardless of status', async () => {
    const { client, from, select, eq } = makeFakeClientForExistence([]);
    const result = await rowsExistForDate(client, '2026-07-29');

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: false });
    expect(eq).toHaveBeenCalledWith('service_date', '2026-07-29');
    expect(result).toBe(false);
  });

  it('returns true when rows exist even if none are pending', async () => {
    const { client } = makeFakeClientForExistence([{ id: 'a' }]);
    const result = await rowsExistForDate(client, '2026-07-29');
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL — `../src/repository.js` does not exist.

- [ ] **Step 4: Implement repository.ts**

```ts
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

export async function upsertRows(client: SupabaseClient, rows: ScheduledServiceRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from('scheduled_services').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`upsertRows failed: ${error.message}`);
}

export async function insertSeedRows(
  client: SupabaseClient,
  rows: ScheduledServiceRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from('scheduled_services').insert(rows);
  if (error) throw new Error(`insertSeedRows failed: ${error.message}`);
}

export async function rowsExistForDate(client: SupabaseClient, serviceDate: string): Promise<boolean> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('id', { count: 'exact', head: false })
    .eq('service_date', serviceDate);

  if (error) throw new Error(`rowsExistForDate failed: ${error.message}`);
  return (data ?? []).length > 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add poller/src/supabaseClient.ts poller/src/repository.ts poller/test/repository.test.ts
git commit -m "Add Supabase data access layer for scheduled_services"
```

Note: `rowsExistForDate`'s `head: false` (i.e. actually returning rows, not
just a count) is intentional here even though only presence matters — it
keeps the fake-client shape in tests identical to `fetchPendingRows`'s,
avoiding a second mocking pattern for one extra field.

---

### Task 9: Orchestration, Dockerfile, dry-run mode

**Files:**
- Create: `poller/src/index.ts`
- Create: `poller/Dockerfile`
- Create: `poller/docker-compose.yml`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces: the running poller process — the deployable artifact for this
  plan. No further tasks consume this as a code interface.

- [ ] **Step 1: Implement index.ts**

```ts
// poller/src/index.ts
import { loadConfig } from './config.js';
import { createSupabaseClient } from './supabaseClient.js';
import { fetchPendingRows, upsertRows, insertSeedRows, rowsExistForDate } from './repository.js';
import { fetchArrivals } from './tflClient.js';
import { runPollCycle } from './pollCycle.js';
import { buildSeedRows } from './schedule.js';
import scheduleConfig from '../schedule.json' with { type: 'json' };
import type { ScheduleConfig } from './types.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

function todayLondon(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

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

  const [pendingRows, predictions] = await Promise.all([
    fetchPendingRows(client, serviceDate),
    fetchArrivals(config.tflStopPointId),
  ]);

  const changed = runPollCycle(pendingRows, predictions, new Date());

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
```

- [ ] **Step 2: Write the Dockerfile**

```dockerfile
# poller/Dockerfile
# Node 22+ required: @supabase/supabase-js resolved to a version whose
# package.json declares engines.node >= 22 (found during Task 2 review).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json schedule.json ./
COPY src ./src

CMD ["npx", "tsx", "src/index.ts"]
```

- [ ] **Step 3: Write docker-compose.yml**

```yaml
# poller/docker-compose.yml
services:
  poller:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DRY_RUN: "false"
```

- [ ] **Step 4: Manual verification — dry run against real TfL data**

Run: `cd poller && DRY_RUN=true SUPABASE_URL=<your-url> SUPABASE_SERVICE_ROLE_KEY=<your-key> npm start`

Expected: logs show `[dry-run] would seed N rows for <today>` once, then on
each poll cycle either no output (nothing changed) or
`[dry-run] would upsert N rows: [...]` with plausible-looking data — matched
`vehicle_id`s, `pending` status for rows far from their scheduled time. Let it
run for at least one full scheduled departure's grace period (~20 minutes) to
confirm a real train resolves to `on_time`/`delayed` and, if you can catch a
gap, a cancellation. Stop with Ctrl+C.

If `schedule.json` is still empty (Task 5's data-entry step not yet done),
you'll instead see the `No scheduled services configured` warning — fill in
real timetable data before doing a real dry run.

- [ ] **Step 5: Commit**

```bash
git add poller/src/index.ts poller/Dockerfile poller/docker-compose.yml
git commit -m "Add poller orchestration, Dockerfile, and dry-run mode"
```

---

### Task 10: Go live + operational README

**Files:**
- Create: `poller/README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write poller/README.md**

```markdown
# Barking Riverside Poller

Polls TfL's live Arrivals feed for Barking Riverside station, matches it
against `schedule.json`, and records on-time/delayed/cancelled outcomes to
Supabase.

## Setup

1. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (from your Supabase project's API settings).
2. Make sure `schedule.json` has real timetable data (see the file's
   `effective_from` field) — see "Updating the schedule" below.

## Running locally

    npm install
    npm start

Set `DRY_RUN=true` to log intended changes without writing to Supabase.

## Running in Docker (homelab)

    docker compose up -d --build

Check logs with `docker compose logs -f`.

## Updating the schedule

National Rail timetables change a few times a year (typically May and
December). When Barking Riverside's published timetable changes:

1. Look up the new timetable (nationalrail.co.uk journey planner for station
   code `BGV`, or the TfL Suffragette line page).
2. Update `schedule.json`'s `weekday`/`saturday`/`sunday` arrays and bump
   `effective_from` to the change date.
3. Redeploy: `docker compose up -d --build`.

No code changes or database migrations are needed for a schedule update.

## Running tests

    npm test
```

- [ ] **Step 2: Commit**

```bash
git add poller/README.md
git commit -m "Add poller operational README"
```

---

## Definition of done for this plan

- `npm test` passes in `poller/` with all unit tests green.
- Supabase project exists with `scheduled_services` table and RLS verified
  (anon can `SELECT`, cannot write).
- `schedule.json` contains real timetable data for Barking Riverside.
- A dry run against live TfL data has been observed producing plausible
  matches, at least one resolved arrival, and (schedule permitting) is capable
  of producing a cancellation.
- The poller runs in Docker via `docker compose up -d --build` in the
  homelab, writing real rows to Supabase (`DRY_RUN` unset or `false`).
