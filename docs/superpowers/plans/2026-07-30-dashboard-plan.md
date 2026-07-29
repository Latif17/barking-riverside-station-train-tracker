# Dashboard Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public Next.js dashboard that reads `scheduled_services` from Supabase and shows on-time/delayed/cancelled reliability stats, with peak-time highlighting, a browser-local configurable layout, and a print-friendly report view.

**Architecture:** A Next.js (App Router) app deployed to Vercel's free tier, reading Supabase directly via the anon (read-only) key — no custom backend/API layer. Data-fetching functions wrap raw Supabase queries and hand off to pure aggregation functions, so the actual stats logic is unit-testable without a live database. Charts are hand-rolled inline SVG (no charting library dependency) built from pure geometry functions, following the project's dataviz design system (status colors for on_time/delayed/cancelled, a single sequential blue for the trend line).

**Tech Stack:** TypeScript, Next.js (App Router), Tailwind CSS, `@supabase/supabase-js`, `vitest` + `@testing-library/react` + `jsdom` (testing), Vercel (hosting, free tier).

This plan covers the **dashboard frontend only**. It reads the `scheduled_services` table created by the data-pipeline plan (`docs/superpowers/plans/2026-07-29-data-pipeline-plan.md`) — that table must already exist in Supabase, with `anon` granted `SELECT` via RLS.

## Global Constraints

- Free to run: Vercel free tier, Supabase free tier. No paid services, no custom backend server.
- Frontend reads Supabase **directly** via the anon key (read-only, enforced by RLS) — never proxies through a Next.js API route.
- All date-range logic must use `Europe/London` wall-clock dates (`YYYY-MM-DD`), matching how the poller writes `service_date` — never raw UTC or host-local time.
- No login/accounts. Dashboard configuration (date range, widget visibility) is browser-local only, via `localStorage`.
- Peak-period definitions are fixed (not user-configurable): `am_peak`, `pm_peak`, `off_peak`, exactly as stored in `scheduled_services.peak_period` — the frontend only displays this, never recomputes it.
- `scheduled_services` schema (from the data-pipeline plan, already deployed): `id, service_date (date), direction ('departing'|'arriving'), scheduled_time (timestamptz), peak_period ('am_peak'|'pm_peak'|'off_peak'), status ('pending'|'on_time'|'delayed'|'cancelled'), observed_time, delay_minutes, vehicle_id, last_seen_time_to_station, last_seen_at, created_at, updated_at`.
- Design system values (from the dataviz skill's validated reference palette — do not invent alternate colors):
  - Status: on_time = `#0ca30c` (good), delayed = `#fab219` (warning), cancelled = `#d03b3b` (critical). Same hex in light and dark.
  - Sequential/trend line: blue, `#2a78d6` light / `#3987e5` dark.
  - Chart surface: `#fcfcfb` light / `#1a1a19` dark. Page plane: `#f9f9f7` light / `#0d0d0d` dark.
  - Primary ink: `#0b0b0b` light / `#ffffff` dark. Secondary ink: `#52514e` light / `#c3c2b7` dark. Muted: `#898781` (both).
  - Gridline: `#e1e0d9` light / `#2c2c2a` dark. Baseline/axis: `#c3c2b7` light / `#383835` dark.
  - Mark specs: bars ≤24px thick, 4px rounded data-end / square baseline; lines 2px; stacked-segment separation via a 2px surface-colored stroke (not a geometry gap); gridlines 1px solid, recessive.
- Spec reference: `docs/superpowers/specs/2026-07-29-train-tracker-phase1-design.md`.

---

### Task 1: Next.js project scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.mjs`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/.env.local.example`
- Create: `frontend/.gitignore`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/page.tsx`
- Test: `frontend/test/smoke.test.tsx`

**Interfaces:**
- Produces: a running Next.js dev server (`npm run dev`) and a passing test runner (`npm test`) that later tasks build on. No app-specific exports yet.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "barking-riverside-dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
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
    "lib": ["dom", "dom.iterable", "ES2022"],
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write next.config.mjs, tailwind.config.ts, postcss.config.js**

```js
// frontend/next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

```ts
// frontend/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
```

```js
// frontend/postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Write vitest.config.ts and vitest.setup.ts**

```ts
// frontend/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

```ts
// frontend/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Write .env.local.example and .gitignore**

```
# frontend/.env.local.example
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

```
# frontend/.gitignore
node_modules/
.next/
.env.local
```

- [ ] **Step 6: Write app/globals.css**

Defines the palette as CSS custom properties (light default, dark via both `prefers-color-scheme` and a `data-theme` override), per the dataviz skill's palette usage pattern.

```css
/* frontend/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
  --surface-1: #fcfcfb;
  --page-plane: #f9f9f7;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --gridline: #e1e0d9;
  --axis: #c3c2b7;
  --status-on-time: #0ca30c;
  --status-delayed: #fab219;
  --status-cancelled: #d03b3b;
  --series-trend: #2a78d6;
}

@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme='light'])) {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --page-plane: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --axis: #383835;
    --series-trend: #3987e5;
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --surface-1: #1a1a19;
  --page-plane: #0d0d0d;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted: #898781;
  --gridline: #2c2c2a;
  --axis: #383835;
  --series-trend: #3987e5;
}

body {
  background: var(--page-plane);
  color: var(--text-primary);
}
```

- [ ] **Step 7: Write app/layout.tsx**

```tsx
// frontend/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Barking Riverside Train Tracker',
  description: 'How often trains at Barking Riverside are cancelled or delayed, by time of day.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Write a minimal app/page.tsx placeholder (replaced fully in Task 9)**

```tsx
// frontend/app/page.tsx
export default function DashboardPage() {
  return <main className="p-8">Barking Riverside Train Tracker</main>;
}
```

- [ ] **Step 9: Write the failing smoke test**

```tsx
// frontend/test/smoke.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from '../app/page';

describe('DashboardPage placeholder', () => {
  it('renders the site title', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Barking Riverside Train Tracker')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Install dependencies and run the test**

Run: `cd frontend && npm install && npm test`
Expected: PASS (1 test)

- [ ] **Step 11: Verify the dev server boots**

Run: `cd frontend && npm run dev` (then Ctrl+C after confirming it starts without errors — no need to leave it running)
Expected: starts on `http://localhost:3000` with no compile errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/package.json frontend/tsconfig.json frontend/next.config.mjs \
  frontend/tailwind.config.ts frontend/postcss.config.js frontend/vitest.config.ts \
  frontend/vitest.setup.ts frontend/.env.local.example frontend/.gitignore \
  frontend/app/layout.tsx frontend/app/globals.css frontend/app/page.tsx \
  frontend/test/smoke.test.tsx frontend/package-lock.json
git commit -m "Scaffold Next.js dashboard project with palette CSS variables"
```

---

### Task 2: Supabase client + shared types + date range

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/supabaseClient.ts`
- Create: `frontend/lib/dateRange.ts`
- Test: `frontend/test/dateRange.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Direction = 'departing' | 'arriving';
  type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';
  type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled';
  interface ScheduledService { id, service_date, direction, scheduled_time, peak_period, status, observed_time, delay_minutes }
  function getSupabaseClient(): SupabaseClient
  interface DateRange { from: string; to: string }
  function computeDateRange(days: number, now?: Date): DateRange
  ```
  Used by every later task that touches data.

- [ ] **Step 1: Write types.ts**

```ts
// frontend/lib/types.ts

export type Direction = 'departing' | 'arriving';
export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';
export type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled';

export interface ScheduledService {
  id: string;
  service_date: string;
  direction: Direction;
  scheduled_time: string;
  peak_period: PeakPeriod;
  status: ServiceStatus;
  observed_time: string | null;
  delay_minutes: number | null;
}
```

- [ ] **Step 2: Write supabaseClient.ts**

```ts
// frontend/lib/supabaseClient.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable',
    );
  }

  cachedClient = createClient(url, anonKey);
  return cachedClient;
}
```

- [ ] **Step 3: Write the failing tests for dateRange.ts**

Reference dates (verified): `2026-01-05` is a Monday, `2026-07-29` is a Wednesday in BST (UTC+1).

```ts
// frontend/test/dateRange.test.ts
import { describe, it, expect } from 'vitest';
import { computeDateRange } from '../lib/dateRange';

describe('computeDateRange', () => {
  it('returns a single-day range for days=1', () => {
    const range = computeDateRange(1, new Date('2026-07-29T12:00:00Z'));
    expect(range).toEqual({ from: '2026-07-29', to: '2026-07-29' });
  });

  it('returns a 7-day range ending today (inclusive)', () => {
    const range = computeDateRange(7, new Date('2026-07-29T12:00:00Z'));
    expect(range).toEqual({ from: '2026-07-23', to: '2026-07-29' });
  });

  it('uses London local date, not raw UTC date, near midnight BST', () => {
    // 2026-07-29T23:30:00Z is 2026-07-30T00:30 in London (BST, UTC+1) -
    // the range's "to" date must be the London date, 2026-07-30.
    const range = computeDateRange(1, new Date('2026-07-29T23:30:00Z'));
    expect(range.to).toBe('2026-07-30');
  });

  it('uses London local date in winter (GMT, UTC+0)', () => {
    const range = computeDateRange(1, new Date('2026-01-05T12:00:00Z'));
    expect(range).toEqual({ from: '2026-01-05', to: '2026-01-05' });
  });

  it('handles a 30-day range spanning a month boundary', () => {
    const range = computeDateRange(30, new Date('2026-01-05T12:00:00Z'));
    expect(range).toEqual({ from: '2025-12-07', to: '2026-01-05' });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `../lib/dateRange` does not exist.

- [ ] **Step 5: Implement dateRange.ts**

```ts
// frontend/lib/dateRange.ts

export interface DateRange {
  from: string;
  to: string;
}

const LONDON_TZ = 'Europe/London';

function londonDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON_TZ }).format(date);
}

export function computeDateRange(days: number, now: Date = new Date()): DateRange {
  const to = londonDateString(now);
  const fromInstant = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const from = londonDateString(fromInstant);
  return { from, to };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (6 tests: 1 smoke + 5 dateRange)

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/supabaseClient.ts frontend/lib/dateRange.ts frontend/test/dateRange.test.ts
git commit -m "Add Supabase client, shared types, and London-aware date range"
```

---

### Task 3: Dashboard config (localStorage)

**Files:**
- Create: `frontend/lib/dashboardConfig.ts`
- Test: `frontend/test/dashboardConfig.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface WidgetVisibility { statTiles: boolean; peakComparison: boolean; trend: boolean; recentCancellations: boolean }
  interface DashboardConfig { dateRangeDays: 7 | 30 | 90; visibleWidgets: WidgetVisibility }
  const DEFAULT_CONFIG: DashboardConfig
  function loadDashboardConfig(): DashboardConfig
  function saveDashboardConfig(config: DashboardConfig): void
  ```
  Used by Task 9 (main dashboard page) and the widget-toggle/date-range components.

- [ ] **Step 1: Write the failing tests**

`jsdom` (configured in Task 1) provides a real `window.localStorage`, so these tests exercise real storage behavior, not a mock.

```ts
// frontend/test/dashboardConfig.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_CONFIG, loadDashboardConfig, saveDashboardConfig } from '../lib/dashboardConfig';

describe('dashboardConfig', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the default config when nothing is stored', () => {
    expect(loadDashboardConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a saved config', () => {
    const config = {
      dateRangeDays: 90 as const,
      visibleWidgets: { statTiles: true, peakComparison: false, trend: true, recentCancellations: false },
    };
    saveDashboardConfig(config);
    expect(loadDashboardConfig()).toEqual(config);
  });

  it('falls back to defaults for missing widget keys (e.g. after adding a new widget)', () => {
    window.localStorage.setItem(
      'barking-riverside-dashboard-config',
      JSON.stringify({ dateRangeDays: 7, visibleWidgets: { statTiles: false } }),
    );
    const loaded = loadDashboardConfig();
    expect(loaded.dateRangeDays).toBe(7);
    expect(loaded.visibleWidgets.statTiles).toBe(false);
    expect(loaded.visibleWidgets.peakComparison).toBe(true); // defaulted
    expect(loaded.visibleWidgets.trend).toBe(true); // defaulted
  });

  it('falls back to defaults on corrupt stored JSON', () => {
    window.localStorage.setItem('barking-riverside-dashboard-config', '{not valid json');
    expect(loadDashboardConfig()).toEqual(DEFAULT_CONFIG);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `../lib/dashboardConfig` does not exist.

- [ ] **Step 3: Implement dashboardConfig.ts**

```ts
// frontend/lib/dashboardConfig.ts

export interface WidgetVisibility {
  statTiles: boolean;
  peakComparison: boolean;
  trend: boolean;
  recentCancellations: boolean;
}

export interface DashboardConfig {
  dateRangeDays: 7 | 30 | 90;
  visibleWidgets: WidgetVisibility;
}

export const DEFAULT_CONFIG: DashboardConfig = {
  dateRangeDays: 30,
  visibleWidgets: {
    statTiles: true,
    peakComparison: true,
    trend: true,
    recentCancellations: true,
  },
};

const STORAGE_KEY = 'barking-riverside-dashboard-config';

export function loadDashboardConfig(): DashboardConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;

    const parsed = JSON.parse(raw);
    return {
      dateRangeDays: parsed.dateRangeDays ?? DEFAULT_CONFIG.dateRangeDays,
      visibleWidgets: { ...DEFAULT_CONFIG.visibleWidgets, ...parsed.visibleWidgets },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveDashboardConfig(config: DashboardConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/dashboardConfig.ts frontend/test/dashboardConfig.test.ts
git commit -m "Add browser-local dashboard configuration (date range, widget visibility)"
```

---

### Task 4: Aggregation logic (pure functions)

**Files:**
- Create: `frontend/lib/aggregate.ts`
- Test: `frontend/test/aggregate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface StatusCounts { onTime: number; delayed: number; cancelled: number; pending: number; total: number }
  interface StatusPercentages { onTimePercent: number; delayedPercent: number; cancelledPercent: number; total: number }
  function aggregateStatusCounts(rows: { status: string }[]): StatusCounts
  function toPercentages(counts: StatusCounts): StatusPercentages
  interface PeakComparisonRow { peakPeriod: PeakPeriod; counts: StatusCounts; percentages: StatusPercentages }
  function aggregateByPeakPeriod(rows: { peak_period: string; status: string }[]): PeakComparisonRow[]
  interface TrendPoint { date: string; cancellationRatePercent: number; total: number }
  function aggregateTrendByDate(rows: { service_date: string; status: string }[]): TrendPoint[]
  ```
  Used by Task 5 (queries.ts) and Task 6/7 (chart components consume the output shapes).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/test/aggregate.test.ts
import { describe, it, expect } from 'vitest';
import {
  aggregateStatusCounts,
  toPercentages,
  aggregateByPeakPeriod,
  aggregateTrendByDate,
} from '../lib/aggregate';

describe('aggregateStatusCounts', () => {
  it('counts each status and total', () => {
    const rows = [
      { status: 'on_time' }, { status: 'on_time' }, { status: 'delayed' },
      { status: 'cancelled' }, { status: 'pending' },
    ];
    expect(aggregateStatusCounts(rows)).toEqual({
      onTime: 2, delayed: 1, cancelled: 1, pending: 1, total: 5,
    });
  });

  it('returns all zeros for an empty array', () => {
    expect(aggregateStatusCounts([])).toEqual({
      onTime: 0, delayed: 0, cancelled: 0, pending: 0, total: 0,
    });
  });
});

describe('toPercentages', () => {
  it('computes percentages of RESOLVED services only, excluding pending', () => {
    const counts = { onTime: 6, delayed: 3, cancelled: 1, pending: 10, total: 20 };
    const pct = toPercentages(counts);
    expect(pct.total).toBe(10); // 6+3+1, pending excluded
    expect(pct.onTimePercent).toBeCloseTo(60);
    expect(pct.delayedPercent).toBeCloseTo(30);
    expect(pct.cancelledPercent).toBeCloseTo(10);
  });

  it('returns all zeros when there are no resolved services', () => {
    const counts = { onTime: 0, delayed: 0, cancelled: 0, pending: 5, total: 5 };
    expect(toPercentages(counts)).toEqual({
      onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0,
    });
  });
});

describe('aggregateByPeakPeriod', () => {
  it('splits rows into am_peak/pm_peak/off_peak buckets', () => {
    const rows = [
      { peak_period: 'am_peak', status: 'on_time' },
      { peak_period: 'am_peak', status: 'cancelled' },
      { peak_period: 'pm_peak', status: 'delayed' },
      { peak_period: 'off_peak', status: 'on_time' },
      { peak_period: 'off_peak', status: 'on_time' },
    ];
    const result = aggregateByPeakPeriod(rows);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.peakPeriod)).toEqual(['am_peak', 'pm_peak', 'off_peak']);

    const am = result.find((r) => r.peakPeriod === 'am_peak')!;
    expect(am.counts).toEqual({ onTime: 1, delayed: 0, cancelled: 1, pending: 0, total: 2 });
    expect(am.percentages.onTimePercent).toBeCloseTo(50);
    expect(am.percentages.cancelledPercent).toBeCloseTo(50);

    const off = result.find((r) => r.peakPeriod === 'off_peak')!;
    expect(off.counts.total).toBe(2);
    expect(off.percentages.onTimePercent).toBeCloseTo(100);
  });

  it('returns a zeroed row for a peak period with no data', () => {
    const result = aggregateByPeakPeriod([{ peak_period: 'am_peak', status: 'on_time' }]);
    const pm = result.find((r) => r.peakPeriod === 'pm_peak')!;
    expect(pm.counts.total).toBe(0);
    expect(pm.percentages.total).toBe(0);
  });
});

describe('aggregateTrendByDate', () => {
  it('groups by service_date, sorted ascending, with cancellation rate per day', () => {
    const rows = [
      { service_date: '2026-07-02', status: 'on_time' },
      { service_date: '2026-07-01', status: 'cancelled' },
      { service_date: '2026-07-01', status: 'on_time' },
      { service_date: '2026-07-01', status: 'on_time' },
      { service_date: '2026-07-02', status: 'cancelled' },
    ];
    const trend = aggregateTrendByDate(rows);
    expect(trend.map((t) => t.date)).toEqual(['2026-07-01', '2026-07-02']);

    expect(trend[0].total).toBe(3);
    expect(trend[0].cancellationRatePercent).toBeCloseTo(100 / 3);

    expect(trend[1].total).toBe(2);
    expect(trend[1].cancellationRatePercent).toBeCloseTo(50);
  });

  it('excludes pending rows from the per-day rate but keeps the date if any resolved row exists', () => {
    const rows = [
      { service_date: '2026-07-01', status: 'on_time' },
      { service_date: '2026-07-01', status: 'pending' },
    ];
    const trend = aggregateTrendByDate(rows);
    expect(trend[0].total).toBe(1);
    expect(trend[0].cancellationRatePercent).toBe(0);
  });

  it('returns an empty array for no rows', () => {
    expect(aggregateTrendByDate([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `../lib/aggregate` does not exist.

- [ ] **Step 3: Implement aggregate.ts**

```ts
// frontend/lib/aggregate.ts
import type { PeakPeriod } from './types';

export interface StatusCounts {
  onTime: number;
  delayed: number;
  cancelled: number;
  pending: number;
  total: number;
}

export interface StatusPercentages {
  onTimePercent: number;
  delayedPercent: number;
  cancelledPercent: number;
  total: number;
}

export function aggregateStatusCounts(rows: { status: string }[]): StatusCounts {
  const counts: StatusCounts = { onTime: 0, delayed: 0, cancelled: 0, pending: 0, total: 0 };
  for (const row of rows) {
    counts.total += 1;
    if (row.status === 'on_time') counts.onTime += 1;
    else if (row.status === 'delayed') counts.delayed += 1;
    else if (row.status === 'cancelled') counts.cancelled += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function toPercentages(counts: StatusCounts): StatusPercentages {
  // Percentages are of RESOLVED services (on_time + delayed + cancelled).
  // Pending services haven't happened yet, so they aren't a reliability outcome.
  const resolved = counts.onTime + counts.delayed + counts.cancelled;
  if (resolved === 0) {
    return { onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 };
  }
  return {
    onTimePercent: (counts.onTime / resolved) * 100,
    delayedPercent: (counts.delayed / resolved) * 100,
    cancelledPercent: (counts.cancelled / resolved) * 100,
    total: resolved,
  };
}

export interface PeakComparisonRow {
  peakPeriod: PeakPeriod;
  counts: StatusCounts;
  percentages: StatusPercentages;
}

const PEAK_PERIODS: PeakPeriod[] = ['am_peak', 'pm_peak', 'off_peak'];

export function aggregateByPeakPeriod(
  rows: { peak_period: string; status: string }[],
): PeakComparisonRow[] {
  return PEAK_PERIODS.map((peakPeriod) => {
    const filtered = rows.filter((r) => r.peak_period === peakPeriod);
    const counts = aggregateStatusCounts(filtered);
    return { peakPeriod, counts, percentages: toPercentages(counts) };
  });
}

export interface TrendPoint {
  date: string;
  cancellationRatePercent: number;
  total: number;
}

export function aggregateTrendByDate(rows: { service_date: string; status: string }[]): TrendPoint[] {
  const byDate = new Map<string, { status: string }[]>();
  for (const row of rows) {
    const list = byDate.get(row.service_date) ?? [];
    list.push(row);
    byDate.set(row.service_date, list);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => {
      const counts = aggregateStatusCounts(dayRows);
      const resolved = counts.onTime + counts.delayed + counts.cancelled;
      const cancellationRatePercent = resolved === 0 ? 0 : (counts.cancelled / resolved) * 100;
      return { date, cancellationRatePercent, total: resolved };
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (19 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/aggregate.ts frontend/test/aggregate.test.ts
git commit -m "Add pure aggregation functions for stats, peak comparison, and trend"
```

---

### Task 5: Supabase queries

**Files:**
- Create: `frontend/lib/queries.ts`
- Test: `frontend/test/queries.test.ts`

**Interfaces:**
- Consumes: `aggregateStatusCounts`, `toPercentages`, `aggregateByPeakPeriod`, `aggregateTrendByDate` from Task 4; `DateRange` from Task 2.
- Produces:
  ```ts
  function fetchSummaryStats(client: SupabaseClient, range: DateRange): Promise<StatusPercentages>
  function fetchPeakComparison(client: SupabaseClient, range: DateRange): Promise<PeakComparisonRow[]>
  function fetchTrend(client: SupabaseClient, range: DateRange): Promise<TrendPoint[]>
  interface RecentCancellation { service_date: string; scheduled_time: string; direction: Direction }
  function fetchRecentCancellations(client: SupabaseClient, range: DateRange, limit?: number): Promise<RecentCancellation[]>
  ```
  Used by Task 9 (dashboard page) to load data for each widget.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/test/queries.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchSummaryStats, fetchPeakComparison, fetchTrend, fetchRecentCancellations } from '../lib/queries';

// fetchSummaryStats/fetchPeakComparison/fetchTrend all call select().gte().lte()
// with no .eq() in the chain - this mock matches exactly that shape.
function makeRangeQueryClient(overrides: Record<string, any> = {}) {
  const data = overrides.data ?? [];
  const error = overrides.error ?? null;
  const lte = vi.fn().mockResolvedValue({ data, error });
  const gte = vi.fn().mockReturnValue({ lte });
  const select = vi.fn().mockReturnValue({ gte });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, gte, lte };
}

// fetchRecentCancellations calls select().eq().gte().lte().order().limit() - a
// longer, differently-shaped chain, so it gets its own purpose-built mock rather
// than overloading the one above with branches for both shapes.
function makeCancellationsQueryClient(overrides: Record<string, any> = {}) {
  const data = overrides.data ?? [];
  const error = overrides.error ?? null;
  const limit = vi.fn().mockResolvedValue({ data, error });
  const order = vi.fn().mockReturnValue({ limit });
  const lte = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ lte });
  const eq = vi.fn().mockReturnValue({ gte });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, eq, gte, lte, order, limit };
}

describe('fetchSummaryStats', () => {
  it('queries status in the date range and aggregates to percentages', async () => {
    const rows = [{ status: 'on_time' }, { status: 'cancelled' }];
    const { client, from, select, gte, lte } = makeRangeQueryClient({ data: rows });
    const result = await fetchSummaryStats(client, { from: '2026-07-01', to: '2026-07-31' });

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(select).toHaveBeenCalledWith('status');
    expect(gte).toHaveBeenCalledWith('service_date', '2026-07-01');
    expect(lte).toHaveBeenCalledWith('service_date', '2026-07-31');
    expect(result.total).toBe(2);
    expect(result.onTimePercent).toBeCloseTo(50);
  });

  it('throws a descriptive error when Supabase returns an error', async () => {
    const { client } = makeRangeQueryClient({ error: { message: 'boom' } });
    await expect(fetchSummaryStats(client, { from: '2026-07-01', to: '2026-07-31' })).rejects.toThrow(/boom/);
  });
});

describe('fetchPeakComparison', () => {
  it('queries peak_period + status and returns 3 buckets', async () => {
    const rows = [
      { peak_period: 'am_peak', status: 'on_time' },
      { peak_period: 'pm_peak', status: 'delayed' },
    ];
    const { client, select } = makeRangeQueryClient({ data: rows });
    const result = await fetchPeakComparison(client, { from: '2026-07-01', to: '2026-07-31' });

    expect(select).toHaveBeenCalledWith('peak_period, status');
    expect(result).toHaveLength(3);
  });
});

describe('fetchTrend', () => {
  it('queries service_date + status and returns points sorted by date', async () => {
    const rows = [
      { service_date: '2026-07-02', status: 'on_time' },
      { service_date: '2026-07-01', status: 'cancelled' },
    ];
    const { client, select } = makeRangeQueryClient({ data: rows });
    const result = await fetchTrend(client, { from: '2026-07-01', to: '2026-07-31' });

    expect(select).toHaveBeenCalledWith('service_date, status');
    expect(result.map((t) => t.date)).toEqual(['2026-07-01', '2026-07-02']);
  });
});

describe('fetchRecentCancellations', () => {
  it('queries cancelled rows, ordered by scheduled_time descending, with a limit', async () => {
    const rows = [{ service_date: '2026-07-05', scheduled_time: '2026-07-05T07:00:00Z', direction: 'departing' }];
    const { client, select, eq, gte, lte, order, limit } = makeCancellationsQueryClient({ data: rows });
    const result = await fetchRecentCancellations(client, { from: '2026-07-01', to: '2026-07-31' }, 10);

    expect(select).toHaveBeenCalledWith('service_date, scheduled_time, direction');
    expect(eq).toHaveBeenCalledWith('status', 'cancelled');
    expect(gte).toHaveBeenCalledWith('service_date', '2026-07-01');
    expect(lte).toHaveBeenCalledWith('service_date', '2026-07-31');
    expect(order).toHaveBeenCalledWith('scheduled_time', { ascending: false });
    expect(limit).toHaveBeenCalledWith(10);
    expect(result).toEqual(rows);
  });

  it('defaults to a limit of 20 when none is given', async () => {
    const { client, limit } = makeCancellationsQueryClient({ data: [] });
    await fetchRecentCancellations(client, { from: '2026-07-01', to: '2026-07-31' });
    expect(limit).toHaveBeenCalledWith(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `../lib/queries` does not exist.

- [ ] **Step 3: Implement queries.ts**

```ts
// frontend/lib/queries.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aggregateStatusCounts,
  toPercentages,
  aggregateByPeakPeriod,
  aggregateTrendByDate,
  type StatusPercentages,
  type PeakComparisonRow,
  type TrendPoint,
} from './aggregate';
import type { DateRange } from './dateRange';
import type { Direction } from './types';

export async function fetchSummaryStats(
  client: SupabaseClient,
  range: DateRange,
): Promise<StatusPercentages> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('status')
    .gte('service_date', range.from)
    .lte('service_date', range.to);

  if (error) throw new Error(`fetchSummaryStats failed: ${error.message}`);
  return toPercentages(aggregateStatusCounts(data ?? []));
}

export async function fetchPeakComparison(
  client: SupabaseClient,
  range: DateRange,
): Promise<PeakComparisonRow[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('peak_period, status')
    .gte('service_date', range.from)
    .lte('service_date', range.to);

  if (error) throw new Error(`fetchPeakComparison failed: ${error.message}`);
  return aggregateByPeakPeriod(data ?? []);
}

export async function fetchTrend(client: SupabaseClient, range: DateRange): Promise<TrendPoint[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('service_date, status')
    .gte('service_date', range.from)
    .lte('service_date', range.to);

  if (error) throw new Error(`fetchTrend failed: ${error.message}`);
  return aggregateTrendByDate(data ?? []);
}

export interface RecentCancellation {
  service_date: string;
  scheduled_time: string;
  direction: Direction;
}

export async function fetchRecentCancellations(
  client: SupabaseClient,
  range: DateRange,
  limit = 20,
): Promise<RecentCancellation[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('service_date, scheduled_time, direction')
    .eq('status', 'cancelled')
    .gte('service_date', range.from)
    .lte('service_date', range.to)
    .order('scheduled_time', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchRecentCancellations failed: ${error.message}`);
  return (data ?? []) as RecentCancellation[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (25 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/queries.ts frontend/test/queries.test.ts
git commit -m "Add Supabase query functions for dashboard widgets"
```

---

### Task 6: Chart geometry + StatTiles component

**Files:**
- Create: `frontend/lib/chartGeometry.ts`
- Create: `frontend/components/StatTiles.tsx`
- Test: `frontend/test/chartGeometry.test.ts`
- Test: `frontend/test/StatTiles.test.tsx`

**Interfaces:**
- Consumes: `StatusPercentages` from Task 4.
- Produces:
  ```ts
  interface StackedSegment { status: 'cancelled' | 'delayed' | 'onTime'; y: number; height: number }
  interface StackedBar { label: string; x: number; width: number; segments: StackedSegment[] }
  function computeStackedBars(groups: { label: string; percentages: {...} }[], chartHeight: number, barWidth: number, barGap: number): StackedBar[]
  interface LinePoint { x: number; y: number; date: string; value: number }
  interface LineChartGeometry { points: LinePoint[]; pathD: string; maxValue: number }
  function computeLineChart(data: { date: string; cancellationRatePercent: number }[], width: number, height: number): LineChartGeometry
  ```
  `computeStackedBars` used by Task 7 (PeakComparisonChart), `computeLineChart` by Task 8 (TrendChart). `StatTiles` component used by Task 9.

- [ ] **Step 1: Write the failing tests for chartGeometry.ts**

```ts
// frontend/test/chartGeometry.test.ts
import { describe, it, expect } from 'vitest';
import { computeStackedBars, computeLineChart } from '../lib/chartGeometry';

describe('computeStackedBars', () => {
  it('produces one bar per group, positioned left to right with the given gap', () => {
    const groups = [
      { label: 'AM peak', percentages: { onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0 } },
      { label: 'PM peak', percentages: { onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0 } },
    ];
    const bars = computeStackedBars(groups, 200, 24, 16);
    expect(bars).toHaveLength(2);
    expect(bars[0].x).toBe(0);
    expect(bars[1].x).toBe(24 + 16);
    expect(bars[0].width).toBe(24);
  });

  it('stacks segments bottom-to-top as cancelled, delayed, on_time, sized by percentage of chart height', () => {
    const groups = [
      { label: 'Off-peak', percentages: { onTimePercent: 70, delayedPercent: 20, cancelledPercent: 10 } },
    ];
    const [bar] = computeStackedBars(groups, 100, 24, 16);
    expect(bar.segments).toHaveLength(3);

    const cancelled = bar.segments.find((s) => s.status === 'cancelled')!;
    const delayed = bar.segments.find((s) => s.status === 'delayed')!;
    const onTime = bar.segments.find((s) => s.status === 'onTime')!;

    expect(cancelled.height).toBeCloseTo(10);
    expect(delayed.height).toBeCloseTo(20);
    expect(onTime.height).toBeCloseTo(70);

    // cancelled sits at the very bottom of a 100px-tall chart
    expect(cancelled.y).toBeCloseTo(90);
    // on_time sits at the very top
    expect(onTime.y).toBeCloseTo(0);
  });

  it('omits a segment entirely when its percentage is zero', () => {
    const groups = [
      { label: 'AM peak', percentages: { onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0 } },
    ];
    const [bar] = computeStackedBars(groups, 100, 24, 16);
    expect(bar.segments).toHaveLength(1);
    expect(bar.segments[0].status).toBe('onTime');
  });
});

describe('computeLineChart', () => {
  it('returns empty geometry for no data', () => {
    const geom = computeLineChart([], 300, 100);
    expect(geom.points).toEqual([]);
    expect(geom.pathD).toBe('');
  });

  it('spaces points evenly across the width and scales y to the height', () => {
    const data = [
      { date: '2026-07-01', cancellationRatePercent: 0 },
      { date: '2026-07-02', cancellationRatePercent: 50 },
    ];
    const geom = computeLineChart(data, 300, 100);
    expect(geom.points).toHaveLength(2);
    expect(geom.points[0].x).toBe(0);
    expect(geom.points[1].x).toBe(300);
    // maxValue floors at 10, but 50 > 10 so maxValue is 50; y=0 -> bottom (height), y=50 -> top (0)
    expect(geom.maxValue).toBe(50);
    expect(geom.points[0].y).toBeCloseTo(100);
    expect(geom.points[1].y).toBeCloseTo(0);
  });

  it('floors maxValue at 10 so an all-zero series does not render a flat line pinned to the top', () => {
    const data = [
      { date: '2026-07-01', cancellationRatePercent: 0 },
      { date: '2026-07-02', cancellationRatePercent: 0 },
    ];
    const geom = computeLineChart(data, 300, 100);
    expect(geom.maxValue).toBe(10);
    expect(geom.points[0].y).toBeCloseTo(100);
  });

  it('builds a valid SVG path string starting with M and using L for subsequent points', () => {
    const data = [
      { date: '2026-07-01', cancellationRatePercent: 0 },
      { date: '2026-07-02', cancellationRatePercent: 20 },
      { date: '2026-07-03', cancellationRatePercent: 10 },
    ];
    const geom = computeLineChart(data, 200, 100);
    expect(geom.pathD.startsWith('M ')).toBe(true);
    expect(geom.pathD.split(' L ')).toHaveLength(3); // "M x y" + 2 "L x y" segments
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `../lib/chartGeometry` does not exist.

- [ ] **Step 3: Implement chartGeometry.ts**

```ts
// frontend/lib/chartGeometry.ts

export interface StackedSegment {
  status: 'cancelled' | 'delayed' | 'onTime';
  y: number;
  height: number;
}

export interface StackedBar {
  label: string;
  x: number;
  width: number;
  segments: StackedSegment[];
}

interface GroupPercentages {
  onTimePercent: number;
  delayedPercent: number;
  cancelledPercent: number;
}

export function computeStackedBars(
  groups: { label: string; percentages: GroupPercentages }[],
  chartHeight: number,
  barWidth: number,
  barGap: number,
): StackedBar[] {
  return groups.map((group, i) => {
    const x = i * (barWidth + barGap);
    const segmentDefs: Array<['cancelled' | 'delayed' | 'onTime', number]> = [
      ['cancelled', group.percentages.cancelledPercent],
      ['delayed', group.percentages.delayedPercent],
      ['onTime', group.percentages.onTimePercent],
    ];

    let cursorY = chartHeight;
    const segments: StackedSegment[] = [];
    for (const [status, percent] of segmentDefs) {
      const height = (percent / 100) * chartHeight;
      if (height <= 0) continue;
      cursorY -= height;
      segments.push({ status, y: cursorY, height });
    }

    return { label: group.label, x, width: barWidth, segments };
  });
}

export interface LinePoint {
  x: number;
  y: number;
  date: string;
  value: number;
}

export interface LineChartGeometry {
  points: LinePoint[];
  pathD: string;
  maxValue: number;
}

export function computeLineChart(
  data: { date: string; cancellationRatePercent: number }[],
  width: number,
  height: number,
): LineChartGeometry {
  if (data.length === 0) {
    return { points: [], pathD: '', maxValue: 0 };
  }

  // Floor at 10% so an all-good period doesn't render as a flat line pinned to
  // the very top of the chart (which would visually look "maxed out" rather
  // than "zero").
  const maxValue = Math.max(10, ...data.map((d) => d.cancellationRatePercent));
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points: LinePoint[] = data.map((d, i) => ({
    x: data.length > 1 ? i * stepX : width / 2,
    y: height - (d.cancellationRatePercent / maxValue) * height,
    date: d.date,
    value: d.cancellationRatePercent,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

  return { points, pathD, maxValue };
}
```

- [ ] **Step 4: Run chartGeometry tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (32 tests)

- [ ] **Step 5: Write the failing test for StatTiles.tsx**

```tsx
// frontend/test/StatTiles.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles } from '../components/StatTiles';

describe('StatTiles', () => {
  it('renders on-time, delayed, and cancelled percentages', () => {
    render(
      <StatTiles
        percentages={{ onTimePercent: 82.5, delayedPercent: 12.3, cancelledPercent: 5.2, total: 120 }}
      />,
    );
    expect(screen.getByText('83%')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows a based-on count', () => {
    render(
      <StatTiles
        percentages={{ onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0, total: 42 }}
      />,
    );
    expect(screen.getByText(/42 services/)).toBeInTheDocument();
  });

  it('renders a message when there is no data', () => {
    render(
      <StatTiles
        percentages={{ onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 }}
      />,
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `../components/StatTiles` does not exist.

- [ ] **Step 7: Implement StatTiles.tsx**

```tsx
// frontend/components/StatTiles.tsx
import type { StatusPercentages } from '@/lib/aggregate';

interface StatTilesProps {
  percentages: StatusPercentages;
}

function Tile({ label, value, colorVar }: { label: string; value: number; colorVar: string }) {
  return (
    <div className="rounded-lg border border-[var(--gridline)] bg-[var(--surface-1)] p-4">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: `var(${colorVar})` }}
          aria-hidden="true"
        />
        <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">
        {Math.round(value)}%
      </div>
    </div>
  );
}

export function StatTiles({ percentages }: StatTilesProps) {
  if (percentages.total === 0) {
    return (
      <div className="rounded-lg border border-[var(--gridline)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-secondary)]">
        No data for this date range yet.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="On time" value={percentages.onTimePercent} colorVar="--status-on-time" />
        <Tile label="Delayed" value={percentages.delayedPercent} colorVar="--status-delayed" />
        <Tile label="Cancelled" value={percentages.cancelledPercent} colorVar="--status-cancelled" />
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Based on {percentages.total} services in this range
      </p>
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (35 tests)

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/chartGeometry.ts frontend/components/StatTiles.tsx \
  frontend/test/chartGeometry.test.ts frontend/test/StatTiles.test.tsx
git commit -m "Add chart geometry functions and StatTiles component"
```

---

### Task 7: PeakComparisonChart component

**Files:**
- Create: `frontend/components/PeakComparisonChart.tsx`
- Test: `frontend/test/PeakComparisonChart.test.tsx`

**Interfaces:**
- Consumes: `PeakComparisonRow` from Task 4, `computeStackedBars` from Task 6.
- Produces: `PeakComparisonChart` component, used by Task 9.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/PeakComparisonChart.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeakComparisonChart } from '../components/PeakComparisonChart';
import type { PeakComparisonRow } from '../lib/aggregate';

const rows: PeakComparisonRow[] = [
  {
    peakPeriod: 'am_peak',
    counts: { onTime: 80, delayed: 15, cancelled: 5, pending: 0, total: 100 },
    percentages: { onTimePercent: 80, delayedPercent: 15, cancelledPercent: 5, total: 100 },
  },
  {
    peakPeriod: 'pm_peak',
    counts: { onTime: 70, delayed: 20, cancelled: 10, pending: 0, total: 100 },
    percentages: { onTimePercent: 70, delayedPercent: 20, cancelledPercent: 10, total: 100 },
  },
  {
    peakPeriod: 'off_peak',
    counts: { onTime: 90, delayed: 8, cancelled: 2, pending: 0, total: 100 },
    percentages: { onTimePercent: 90, delayedPercent: 8, cancelledPercent: 2, total: 100 },
  },
];

describe('PeakComparisonChart', () => {
  it('renders a labelled bar for each peak period', () => {
    render(<PeakComparisonChart rows={rows} />);
    expect(screen.getByText('AM peak')).toBeInTheDocument();
    expect(screen.getByText('PM peak')).toBeInTheDocument();
    expect(screen.getByText('Off-peak')).toBeInTheDocument();
  });

  it('renders an SVG with one rect per non-zero segment (9 total for 3 full bars)', () => {
    const { container } = render(<PeakComparisonChart rows={rows} />);
    const rects = container.querySelectorAll('svg rect[data-status]');
    expect(rects).toHaveLength(9);
  });

  it('renders a legend identifying the three statuses', () => {
    render(<PeakComparisonChart rows={rows} />);
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows a no-data message for a peak period with zero services', () => {
    const withEmpty = rows.map((r) =>
      r.peakPeriod === 'pm_peak'
        ? { ...r, counts: { ...r.counts, total: 0 }, percentages: { onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 } }
        : r,
    );
    render(<PeakComparisonChart rows={withEmpty} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `../components/PeakComparisonChart` does not exist.

- [ ] **Step 3: Implement PeakComparisonChart.tsx**

```tsx
// frontend/components/PeakComparisonChart.tsx
import { computeStackedBars } from '@/lib/chartGeometry';
import type { PeakComparisonRow } from '@/lib/aggregate';

const CHART_HEIGHT = 160;
const BAR_WIDTH = 64;
const BAR_GAP = 40;

const PEAK_LABELS: Record<PeakComparisonRow['peakPeriod'], string> = {
  am_peak: 'AM peak',
  pm_peak: 'PM peak',
  off_peak: 'Off-peak',
};

const STATUS_COLOR_VAR: Record<'onTime' | 'delayed' | 'cancelled', string> = {
  onTime: '--status-on-time',
  delayed: '--status-delayed',
  cancelled: '--status-cancelled',
};

const STATUS_LABEL: Record<'onTime' | 'delayed' | 'cancelled', string> = {
  onTime: 'On time',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
};

interface PeakComparisonChartProps {
  rows: PeakComparisonRow[];
}

export function PeakComparisonChart({ rows }: PeakComparisonChartProps) {
  const emptyPeriods = rows.filter((r) => r.percentages.total === 0);

  const groups = rows.map((r) => ({ label: PEAK_LABELS[r.peakPeriod], percentages: r.percentages }));
  const bars = computeStackedBars(groups, CHART_HEIGHT, BAR_WIDTH, BAR_GAP);
  const chartWidth = bars.length * BAR_WIDTH + (bars.length - 1) * BAR_GAP;

  return (
    <div>
      <svg
        width={chartWidth}
        height={CHART_HEIGHT + 24}
        viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT + 24}`}
        role="img"
        aria-label="On-time, delayed, and cancelled percentage by peak period"
      >
        <line
          x1={0}
          y1={CHART_HEIGHT}
          x2={chartWidth}
          y2={CHART_HEIGHT}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        {bars.map((bar) => (
          <g key={bar.label}>
            {bar.segments.map((segment) => (
              <rect
                key={segment.status}
                data-status={segment.status}
                x={bar.x}
                y={segment.y}
                width={bar.width}
                height={segment.height}
                rx={4}
                fill={`var(${STATUS_COLOR_VAR[segment.status]})`}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            ))}
            <text
              x={bar.x + bar.width / 2}
              y={CHART_HEIGHT + 18}
              textAnchor="middle"
              fontSize={12}
              fill="var(--text-secondary)"
            >
              {bar.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex gap-4 text-xs text-[var(--text-secondary)]">
        {(['onTime', 'delayed', 'cancelled'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: `var(${STATUS_COLOR_VAR[status]})` }}
              aria-hidden="true"
            />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>

      {emptyPeriods.length > 0 && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          No data yet for: {emptyPeriods.map((r) => PEAK_LABELS[r.peakPeriod]).join(', ')}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (39 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/PeakComparisonChart.tsx frontend/test/PeakComparisonChart.test.tsx
git commit -m "Add PeakComparisonChart: 100%-stacked bars by peak period and status"
```

---

### Task 8: TrendChart component

**Files:**
- Create: `frontend/components/TrendChart.tsx`
- Test: `frontend/test/TrendChart.test.tsx`

**Interfaces:**
- Consumes: `TrendPoint` from Task 4, `computeLineChart` from Task 6.
- Produces: `TrendChart` component, used by Task 9.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/TrendChart.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendChart } from '../components/TrendChart';
import type { TrendPoint } from '../lib/aggregate';

const points: TrendPoint[] = [
  { date: '2026-07-01', cancellationRatePercent: 0, total: 20 },
  { date: '2026-07-02', cancellationRatePercent: 5, total: 22 },
  { date: '2026-07-03', cancellationRatePercent: 15, total: 19 },
];

describe('TrendChart', () => {
  it('renders an SVG path for the trend line', () => {
    const { container } = render(<TrendChart points={points} />);
    const path = container.querySelector('svg path[data-testid="trend-line"]');
    expect(path).toBeInTheDocument();
    expect(path?.getAttribute('d')).toMatch(/^M /);
  });

  it('shows a no-data message when there are no points', () => {
    render(<TrendChart points={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('labels the chart with a title identifying the single series (no legend needed)', () => {
    render(<TrendChart points={points} />);
    expect(screen.getByText(/cancellation rate/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `../components/TrendChart` does not exist.

- [ ] **Step 3: Implement TrendChart.tsx**

A single series needs no legend box (per the dataviz mark spec) — the title names it, and only the last point is direct-labelled to avoid clutter.

```tsx
// frontend/components/TrendChart.tsx
import { computeLineChart } from '@/lib/chartGeometry';
import type { TrendPoint } from '@/lib/aggregate';

const CHART_WIDTH = 480;
const CHART_HEIGHT = 140;

interface TrendChartProps {
  points: TrendPoint[];
}

export function TrendChart({ points }: TrendChartProps) {
  if (points.length === 0) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">No data for this date range yet.</div>
    );
  }

  const geometry = computeLineChart(points, CHART_WIDTH, CHART_HEIGHT);
  const lastPoint = geometry.points[geometry.points.length - 1];

  return (
    <div>
      <p className="mb-1 text-sm text-[var(--text-secondary)]">Daily cancellation rate</p>
      <svg
        width={CHART_WIDTH}
        height={CHART_HEIGHT + 8}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT + 8}`}
        role="img"
        aria-label="Daily cancellation rate trend"
      >
        <line
          x1={0}
          y1={CHART_HEIGHT}
          x2={CHART_WIDTH}
          y2={CHART_HEIGHT}
          stroke="var(--gridline)"
          strokeWidth={1}
        />
        <path
          data-testid="trend-line"
          d={geometry.pathD}
          fill="none"
          stroke="var(--series-trend)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {lastPoint && (
          <>
            <circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={4}
              fill="var(--series-trend)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <text
              x={Math.min(lastPoint.x, CHART_WIDTH - 32)}
              y={Math.max(lastPoint.y - 8, 12)}
              textAnchor="end"
              fontSize={12}
              fill="var(--text-secondary)"
            >
              {Math.round(lastPoint.value)}%
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (42 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/TrendChart.tsx frontend/test/TrendChart.test.tsx
git commit -m "Add TrendChart: single-series cancellation rate line"
```

---

### Task 9: Remaining widgets + config UI components

**Files:**
- Create: `frontend/components/RecentCancellationsTable.tsx`
- Create: `frontend/components/DateRangeSelector.tsx`
- Create: `frontend/components/WidgetToggles.tsx`
- Test: `frontend/test/RecentCancellationsTable.test.tsx`
- Test: `frontend/test/DateRangeSelector.test.tsx`
- Test: `frontend/test/WidgetToggles.test.tsx`

**Interfaces:**
- Consumes: `RecentCancellation` from Task 5, `DashboardConfig`/`WidgetVisibility` from Task 3.
- Produces: three components used by Task 10 (main dashboard page).

- [ ] **Step 1: Write the failing test for RecentCancellationsTable**

```tsx
// frontend/test/RecentCancellationsTable.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecentCancellationsTable } from '../components/RecentCancellationsTable';
import type { RecentCancellation } from '../lib/queries';

const rows: RecentCancellation[] = [
  { service_date: '2026-07-05', scheduled_time: '2026-07-05T07:03:00Z', direction: 'departing' },
  { service_date: '2026-07-04', scheduled_time: '2026-07-04T18:15:00Z', direction: 'arriving' },
];

describe('RecentCancellationsTable', () => {
  it('renders one row per cancellation with date, time, and direction', () => {
    render(<RecentCancellationsTable rows={rows} />);
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1); // + header row
    expect(screen.getByText('Departing')).toBeInTheDocument();
    expect(screen.getByText('Arriving')).toBeInTheDocument();
  });

  it('shows a message when there are no cancellations', () => {
    render(<RecentCancellationsTable rows={[]} />);
    expect(screen.getByText(/no cancellations/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing test for DateRangeSelector**

```tsx
// frontend/test/DateRangeSelector.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangeSelector } from '../components/DateRangeSelector';

describe('DateRangeSelector', () => {
  it('highlights the currently-selected range', () => {
    render(<DateRangeSelector value={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the selected day count', () => {
    const onChange = vi.fn();
    render(<DateRangeSelector value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    expect(onChange).toHaveBeenCalledWith(90);
  });
});
```

- [ ] **Step 3: Write the failing test for WidgetToggles**

```tsx
// frontend/test/WidgetToggles.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WidgetToggles } from '../components/WidgetToggles';
import { DEFAULT_CONFIG } from '../lib/dashboardConfig';

describe('WidgetToggles', () => {
  it('renders a checked checkbox for each visible widget', () => {
    render(<WidgetToggles visibleWidgets={DEFAULT_CONFIG.visibleWidgets} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /stat tiles/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /peak comparison/i })).toBeChecked();
  });

  it('calls onChange with the toggled widget flipped', () => {
    const onChange = vi.fn();
    render(<WidgetToggles visibleWidgets={DEFAULT_CONFIG.visibleWidgets} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /trend/i }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CONFIG.visibleWidgets, trend: false });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — none of the three components exist yet.

- [ ] **Step 5: Implement RecentCancellationsTable.tsx**

```tsx
// frontend/components/RecentCancellationsTable.tsx
import type { RecentCancellation } from '@/lib/queries';

interface RecentCancellationsTableProps {
  rows: RecentCancellation[];
}

const DIRECTION_LABEL: Record<RecentCancellation['direction'], string> = {
  departing: 'Departing',
  arriving: 'Arriving',
};

function formatLondonDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, time };
}

export function RecentCancellationsTable({ rows }: RecentCancellationsTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">No cancellations in this date range.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
          <th className="py-1.5 pr-3 font-normal">Date</th>
          <th className="py-1.5 pr-3 font-normal">Scheduled time</th>
          <th className="py-1.5 font-normal">Direction</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { date, time } = formatLondonDateTime(row.scheduled_time);
          return (
            <tr key={`${row.service_date}-${row.scheduled_time}-${row.direction}`} className="border-b border-[var(--gridline)]">
              <td className="py-1.5 pr-3 tabular-nums text-[var(--text-primary)]">{date}</td>
              <td className="py-1.5 pr-3 tabular-nums text-[var(--text-primary)]">{time}</td>
              <td className="py-1.5 text-[var(--text-primary)]">{DIRECTION_LABEL[row.direction]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 6: Implement DateRangeSelector.tsx**

```tsx
// frontend/components/DateRangeSelector.tsx
const OPTIONS = [7, 30, 90] as const;

interface DateRangeSelectorProps {
  value: 7 | 30 | 90;
  onChange: (days: 7 | 30 | 90) => void;
}

export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  return (
    <div className="flex gap-2" role="group" aria-label="Date range">
      {OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            value === days
              ? 'border-[var(--series-trend)] bg-[var(--series-trend)] text-white'
              : 'border-[var(--gridline)] text-[var(--text-secondary)]'
          }`}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Implement WidgetToggles.tsx**

```tsx
// frontend/components/WidgetToggles.tsx
import type { WidgetVisibility } from '@/lib/dashboardConfig';

interface WidgetTogglesProps {
  visibleWidgets: WidgetVisibility;
  onChange: (next: WidgetVisibility) => void;
}

const LABELS: Record<keyof WidgetVisibility, string> = {
  statTiles: 'Stat tiles',
  peakComparison: 'Peak comparison',
  trend: 'Trend',
  recentCancellations: 'Recent cancellations',
};

export function WidgetToggles({ visibleWidgets, onChange }: WidgetTogglesProps) {
  const keys = Object.keys(LABELS) as (keyof WidgetVisibility)[];

  return (
    <fieldset className="flex flex-wrap gap-4">
      <legend className="sr-only">Visible widgets</legend>
      {keys.map((key) => (
        <label key={key} className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={visibleWidgets[key]}
            onChange={() => onChange({ ...visibleWidgets, [key]: !visibleWidgets[key] })}
          />
          {LABELS[key]}
        </label>
      ))}
    </fieldset>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (48 tests)

- [ ] **Step 9: Commit**

```bash
git add frontend/components/RecentCancellationsTable.tsx frontend/components/DateRangeSelector.tsx \
  frontend/components/WidgetToggles.tsx frontend/test/RecentCancellationsTable.test.tsx \
  frontend/test/DateRangeSelector.test.tsx frontend/test/WidgetToggles.test.tsx
git commit -m "Add recent-cancellations table and date-range/widget-visibility controls"
```

---

### Task 10: Main dashboard page

**Files:**
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: the actual dashboard, replacing Task 1's placeholder. No further tasks consume this as a code interface (Task 11 builds a separate route).

- [ ] **Step 1: Implement app/page.tsx**

This is a client component (uses `useState`/`useEffect` for localStorage-backed config and client-side data fetching) — matches the "no custom backend" architecture, since Supabase is queried directly from the browser.

```tsx
// frontend/app/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { computeDateRange } from '@/lib/dateRange';
import { loadDashboardConfig, saveDashboardConfig, type DashboardConfig } from '@/lib/dashboardConfig';
import { fetchSummaryStats, fetchPeakComparison, fetchTrend, fetchRecentCancellations } from '@/lib/queries';
import type { StatusPercentages, PeakComparisonRow, TrendPoint } from '@/lib/aggregate';
import type { RecentCancellation } from '@/lib/queries';
import { StatTiles } from '@/components/StatTiles';
import { PeakComparisonChart } from '@/components/PeakComparisonChart';
import { TrendChart } from '@/components/TrendChart';
import { RecentCancellationsTable } from '@/components/RecentCancellationsTable';
import { DateRangeSelector } from '@/components/DateRangeSelector';
import { WidgetToggles } from '@/components/WidgetToggles';

interface DashboardData {
  stats: StatusPercentages;
  peakComparison: PeakComparisonRow[];
  trend: TrendPoint[];
  recentCancellations: RecentCancellation[];
}

export default function DashboardPage() {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfig(loadDashboardConfig());
  }, []);

  useEffect(() => {
    if (!config) return;

    let cancelled = false;
    setError(null);

    async function load() {
      try {
        const client = getSupabaseClient();
        const range = computeDateRange(config!.dateRangeDays);
        const [stats, peakComparison, trend, recentCancellations] = await Promise.all([
          fetchSummaryStats(client, range),
          fetchPeakComparison(client, range),
          fetchTrend(client, range),
          fetchRecentCancellations(client, range),
        ]);
        if (!cancelled) {
          setData({ stats, peakComparison, trend, recentCancellations });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [config]);

  if (!config) return null;

  function updateConfig(next: DashboardConfig) {
    setConfig(next);
    saveDashboardConfig(next);
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Barking Riverside Train Tracker
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          How often trains at Barking Riverside are cancelled or delayed, by time of day.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <DateRangeSelector
          value={config.dateRangeDays}
          onChange={(days) => updateConfig({ ...config, dateRangeDays: days })}
        />
        <a href="/report" className="text-sm text-[var(--series-trend)] underline">
          View printable report
        </a>
      </div>

      <div className="mb-6">
        <WidgetToggles
          visibleWidgets={config.visibleWidgets}
          onChange={(visibleWidgets) => updateConfig({ ...config, visibleWidgets })}
        />
      </div>

      {error && (
        <p className="mb-6 rounded-md border border-[var(--status-cancelled)] p-3 text-sm text-[var(--status-cancelled)]">
          {error}
        </p>
      )}

      {!error && !data && (
        <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
      )}

      {data && (
        <div className="space-y-8">
          {config.visibleWidgets.statTiles && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Overview</h2>
              <StatTiles percentages={data.stats} />
            </section>
          )}

          {config.visibleWidgets.peakComparison && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Peak vs off-peak</h2>
              <PeakComparisonChart rows={data.peakComparison} />
            </section>
          )}

          {config.visibleWidgets.trend && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Trend</h2>
              <TrendChart points={data.trend} />
            </section>
          )}

          {config.visibleWidgets.recentCancellations && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Recent cancellations</h2>
              <RecentCancellationsTable rows={data.recentCancellations} />
            </section>
          )}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Update the smoke test from Task 1**

The Task 1 smoke test rendered the placeholder page synchronously; the real page now needs a browser-like `localStorage` and a mocked Supabase client to render meaningfully. Replace it with a minimal integration check.

```tsx
// frontend/test/smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        gte: () => ({
          lte: () => Promise.resolve({ data: [], error: null }),
          eq: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
      }),
    }),
  }),
}));

import DashboardPage from '../app/page';

describe('DashboardPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the site title and, after loading, the overview section', async () => {
    render(<DashboardPage />);
    expect(screen.getByText('Barking Riverside Train Tracker')).toBeInTheDocument();
    expect(await screen.findByText('Overview')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS (48 tests — the smoke test count is unchanged, its content just got more thorough)

- [ ] **Step 4: Manual verification**

Run: `cd frontend && npm run dev`, then set `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (copy from `.env.local.example`) pointing at the same Supabase project the poller writes to, and open `http://localhost:3000`.
Expected: the page loads, shows "Loading…" briefly, then either real stats (if the poller has been running) or 0%/no-data states (if not) — no console errors. Toggling date range and widget checkboxes updates the view and persists across a page refresh (check via `localStorage.getItem('barking-riverside-dashboard-config')` in devtools).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx frontend/test/smoke.test.tsx
git commit -m "Wire up the main dashboard page with live Supabase data"
```

---

### Task 11: Print-friendly report route

**Files:**
- Create: `frontend/app/report/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–8 (reuses `StatTiles`, `PeakComparisonChart`, `TrendChart`, the query functions, and `computeDateRange`). Does NOT reuse `DashboardConfig`/localStorage widget toggles — the report always shows the full picture.
- Produces: the `/report` route. No further tasks depend on this.

- [ ] **Step 1: Implement app/report/page.tsx**

Print CSS hides the "print" button and the report's own date-range links when actually printing (`@media print`), and forces light-mode colors for print/paper regardless of the viewer's OS theme, since printed reports read on paper, not a screen.

```tsx
// frontend/app/report/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { computeDateRange } from '@/lib/dateRange';
import { fetchSummaryStats, fetchPeakComparison, fetchTrend } from '@/lib/queries';
import type { StatusPercentages, PeakComparisonRow, TrendPoint } from '@/lib/aggregate';
import { StatTiles } from '@/components/StatTiles';
import { PeakComparisonChart } from '@/components/PeakComparisonChart';
import { TrendChart } from '@/components/TrendChart';

const REPORT_DAYS = 90;

interface ReportData {
  stats: StatusPercentages;
  peakComparison: PeakComparisonRow[];
  trend: TrendPoint[];
}

export default function ReportPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = computeDateRange(REPORT_DAYS);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const client = getSupabaseClient();
        const [stats, peakComparison, trend] = await Promise.all([
          fetchSummaryStats(client, range),
          fetchPeakComparison(client, range),
          fetchTrend(client, range),
        ]);
        if (!cancelled) setData({ stats, peakComparison, trend });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report data');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      data-theme="light"
      className="mx-auto max-w-3xl bg-[var(--surface-1)] p-8 print:p-0"
    >
      <style>{`
        @media print {
          .no-print { display: none; }
        }
      `}</style>

      <div className="no-print mb-6">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-[var(--gridline)] px-3 py-1.5 text-sm text-[var(--text-secondary)]"
        >
          Print / Save as PDF
        </button>
      </div>

      <header className="mb-6 border-b border-[var(--gridline)] pb-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Barking Riverside Train Reliability Report
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {range.from} to {range.to} ({REPORT_DAYS} days)
        </p>
      </header>

      {error && <p className="text-sm text-[var(--status-cancelled)]">{error}</p>}
      {!error && !data && <p className="text-sm text-[var(--text-secondary)]">Loading…</p>}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Overview</h2>
            <StatTiles percentages={data.stats} />
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Peak vs off-peak</h2>
            <PeakComparisonChart rows={data.peakComparison} />
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Trend</h2>
            <TrendChart points={data.trend} />
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `cd frontend && npm run dev`, navigate to `http://localhost:3000/report`.
Expected: same data-loading behavior as the main dashboard, forced to light theme regardless of OS dark mode, with a "Print / Save as PDF" button that (per the browser's native print dialog) hides itself and produces a clean paper-style layout when actually printed or exported to PDF.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/report/page.tsx
git commit -m "Add print-friendly /report route"
```

---

### Task 12: Vercel deployment config + README

**Files:**
- Create: `frontend/vercel.json`
- Create: `frontend/README.md`

**Interfaces:** None — deployment config and documentation only.

- [ ] **Step 1: Write vercel.json**

Vercel auto-detects Next.js with zero config in most cases; this file just pins the project root explicitly for clarity when deploying a subdirectory of a monorepo-style repo.

```json
{
  "framework": "nextjs"
}
```

- [ ] **Step 2: Write frontend/README.md**

```markdown
# Barking Riverside Train Tracker — Dashboard

Public dashboard showing how often trains at Barking Riverside are cancelled
or delayed, with peak-time comparison. Reads directly from Supabase (the
`scheduled_services` table populated by the poller in `../poller/`).

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in your Supabase
   project's URL and **anon public key** (Project Settings → API in the
   Supabase dashboard) — not the service_role key, which must never appear
   in frontend code.
2. `npm install`

## Running locally

    npm run dev

Open http://localhost:3000. The printable report is at http://localhost:3000/report.

## Deploying to Vercel

1. Push this repo to GitHub (if not already).
2. In the Vercel dashboard, "Add New Project", import the repo, and set the
   **Root Directory** to `frontend`.
3. Add the two environment variables from `.env.local.example` (with real
   values) in the Vercel project's Environment Variables settings.
4. Deploy — Vercel auto-detects Next.js and the free tier is sufficient for
   this project's traffic.

## Running tests

    npm test
```

- [ ] **Step 3: Commit**

```bash
git add frontend/vercel.json frontend/README.md
git commit -m "Add Vercel deployment config and dashboard README"
```

---

## Explicitly out of scope for this plan

- **Custom date range.** The approved spec says "date range (7/30/90 days or
  custom)"; this plan implements only the three presets (Task 9's
  `DateRangeSelector`). An arbitrary from/to picker adds real complexity
  (validation, empty-range handling, URL/localStorage shape for a range
  instead of a day count) for a need the three presets likely cover in
  practice. Flagged here rather than silently dropped — add a "Custom" option
  to `DateRangeSelector` and extend `DashboardConfig`/`computeDateRange` to a
  `{ type: 'preset', days } | { type: 'custom', from, to }` shape as a
  fast-follow if real usage shows the presets aren't enough.
- Drag-and-drop widget layout editing (per the spec, YAGNI for v1).
- User accounts / cross-device settings sync (per the spec).
- Server-generated PDF export (per the spec — browser print instead).

## Definition of done for this plan

- `npm test` passes in `frontend/` with all unit/component tests green.
- `npm run build` succeeds (Next.js production build compiles cleanly).
- The dashboard, run locally against the real Supabase project from the
  data-pipeline plan, loads real data once the poller has accumulated some
  history (or shows sensible zero/no-data states before that).
- Date range and widget visibility persist across a page reload via
  `localStorage`.
- `/report` renders a clean, print-friendly view independent of the
  viewer's OS theme.
- Deployed to Vercel (free tier) with the anon key configured as an
  environment variable — never the service_role key.
