# Executive Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Barking Riverside Train Tracker dashboard executive redesign by adding Failure Reasons components and Executive KPI tiles, and parsing cancellation reasons from RTT.

**Architecture:** 
- Update the poller to extract `cancellationReasonCode` and `latenessReasonCode` from the RTT API.
- Add aggregation functions for executive KPIs (Failure Reasons, Delay Origins, Direction Breakdown).
- Build the `ExecutiveKPIs` and `FailureReasonsChart` React components to surface diagnostic data.
- Update `page.tsx` to include the new data and components.

**Tech Stack:** Next.js, React, Tailwind CSS, TypeScript, Node.js (poller)

## Global Constraints

- 0-minute tolerance means any train that does not have `status === 'on_time'` or `status === 'early'` with 0 delay minutes is considered delayed or cancelled. 

---

### Task 1: Poller Extraction of Reasons

**Files:**
- Modify: `poller/src/rttClient.ts`

**Interfaces:**
- Produces: `cancel_reason` and `delay_reason` strings in `ScheduledServiceRow` populated from RTT API data.

- [ ] **Step 1: Update RttIndividualTemporalData interface**

In `poller/src/rttClient.ts`, add the reason fields to `RttIndividualTemporalData`:
```typescript
export interface RttIndividualTemporalData {
  scheduleAdvertised?: string;
  realtimeActual?: string;
  realtimeForecast?: string;
  realtimeAdvertisedLateness?: number;
  isCancelled?: boolean;
  cancellationReasonCode?: string;
  cancellationReasonShortText?: string;
  latenessReasonCode?: string;
  latenessReasonShortText?: string;
}
```

- [ ] **Step 2: Update mapRttServiceToRows function**

In `poller/src/rttClient.ts`, update the returned object inside `mapRttServiceToRows` to map the reason fields (replace the end of the `return` statement):
```typescript
    return {
      service_date,
      direction,
      scheduled_time,
      peak_period,
      status,
      observed_time: block.realtimeActual ? new Date(block.realtimeActual).toISOString() : null,
      delay_minutes,
      rtt_uid,
      cancel_reason: block.cancellationReasonShortText ?? block.cancellationReasonCode ?? null,
      delay_reason: block.latenessReasonShortText ?? block.latenessReasonCode ?? null,
    };
```

- [ ] **Step 3: Commit**

```bash
git add poller/src/rttClient.ts
git commit -m "feat(poller): extract cancel and delay reasons from RTT API"
```

### Task 2: Update Frontend Aggregations

**Files:**
- Modify: `frontend/lib/aggregate.ts`
- Modify: `frontend/lib/queries.ts`

**Interfaces:**
- Produces: Aggregation logic for `ExecutiveStats` containing reasons, origins, and directions breakdowns.

- [ ] **Step 1: Add Aggregators to aggregate.ts**

At the bottom of `frontend/lib/aggregate.ts`, add:
```typescript
export interface FailureReasonCount {
  reason: string;
  count: number;
}

export function aggregateFailureReasons(rows: { cancel_reason: string | null; delay_reason: string | null }[]): FailureReasonCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reason = row.cancel_reason || row.delay_reason;
    if (reason) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export interface DelayOrigins {
  upstream: number;
  turnaround: number;
}

export function aggregateDelayOrigins(rows: { delay_minutes: number | null; upstream_delay_minutes: number | null; status: string }[]): DelayOrigins {
  let upstream = 0;
  let turnaround = 0;
  for (const row of rows) {
    if (row.status === 'delayed') {
      const d = row.delay_minutes || 0;
      const u = row.upstream_delay_minutes || 0;
      if (u > 0) upstream++;
      else turnaround++;
    }
  }
  return { upstream, turnaround };
}

export interface FailuresByDirection {
  arriving: number;
  departing: number;
}

export function aggregateFailuresByDirection(rows: { direction: string; status: string }[]): FailuresByDirection {
  let arriving = 0;
  let departing = 0;
  for (const row of rows) {
    if (row.status === 'cancelled' || row.status === 'delayed') {
      if (row.direction === 'arriving') arriving++;
      if (row.direction === 'departing') departing++;
    }
  }
  return { arriving, departing };
}
```

- [ ] **Step 2: Add queries to queries.ts**

At the bottom of `frontend/lib/queries.ts`, add:
```typescript
import {
  aggregateFailureReasons,
  aggregateDelayOrigins,
  aggregateFailuresByDirection,
  type FailureReasonCount,
  type DelayOrigins,
  type FailuresByDirection
} from './aggregate';

export type { FailureReasonCount, DelayOrigins, FailuresByDirection };

export interface ExecutiveStats {
  reasons: FailureReasonCount[];
  origins: DelayOrigins;
  directions: FailuresByDirection;
}

export async function fetchExecutiveStats(client: SupabaseClient, range: DateRange): Promise<ExecutiveStats> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('status, direction, delay_minutes, upstream_delay_minutes, cancel_reason, delay_reason')
    .gte('service_date', range.from)
    .lte('service_date', range.to);
    
  if (error) throw new Error(`fetchExecutiveStats failed: ${error.message}`);
  
  const rows = data ?? [];
  return {
    reasons: aggregateFailureReasons(rows),
    origins: aggregateDelayOrigins(rows),
    directions: aggregateFailuresByDirection(rows),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/aggregate.ts frontend/lib/queries.ts
git commit -m "feat(frontend): add executive stats aggregation and queries"
```

### Task 3: Build Executive KPIs Component

**Files:**
- Create: `frontend/components/ExecutiveKPIs.tsx`

**Interfaces:**
- Consumes: `ExecutiveStats` and `StatusPercentages`.
- Produces: The React component replacing the current StatTiles logic or wrapping it.

- [ ] **Step 1: Write the ExecutiveKPIs component**

Create `frontend/components/ExecutiveKPIs.tsx`:
```tsx
import type { StatusPercentages } from '@/lib/aggregate';
import type { ExecutiveStats } from '@/lib/queries';

interface ExecutiveKPIsProps {
  percentages: StatusPercentages;
  execStats: ExecutiveStats;
}

function KpiTile({ title, value, subtitle }: { title: string; value: React.ReactNode; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-widget)] backdrop-blur-md p-4 shadow-lg">
      <h3 className="text-sm font-medium text-[var(--text-secondary)]">{title}</h3>
      <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">{value}</div>
      {subtitle && <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>}
    </div>
  );
}

export function ExecutiveKPIs({ percentages, execStats }: ExecutiveKPIsProps) {
  if (percentages.total === 0) {
    return <div className="text-sm text-[var(--text-secondary)]">No data for this date range yet.</div>;
  }

  const topReason = execStats.reasons[0];
  const { origins, directions } = execStats;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile 
        title="Strict On-Time" 
        value={`${Math.round(percentages.onTimePercent)}%`} 
        subtitle="0-minute tolerance" 
      />
      <KpiTile 
        title="Top Failure Reason" 
        value={topReason ? topReason.reason : 'None'} 
        subtitle={topReason ? `${topReason.count} incidents` : ''} 
      />
      <KpiTile 
        title="Delay Origin" 
        value={<span className="text-lg">{origins.upstream} vs {origins.turnaround}</span>} 
        subtitle="Upstream vs Turnaround" 
      />
      <KpiTile 
        title="Failures by Direction" 
        value={<span className="text-lg">{directions.arriving} vs {directions.departing}</span>} 
        subtitle="Arriving vs Departing" 
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ExecutiveKPIs.tsx
git commit -m "feat(frontend): add executive KPIs component"
```

### Task 4: Build Failure Reasons Chart

**Files:**
- Create: `frontend/components/FailureReasonsChart.tsx`

**Interfaces:**
- Consumes: `FailureReasonCount[]`

- [ ] **Step 1: Write the FailureReasonsChart component**

Create `frontend/components/FailureReasonsChart.tsx`:
```tsx
import type { FailureReasonCount } from '@/lib/queries';

export function FailureReasonsChart({ reasons }: { reasons: FailureReasonCount[] }) {
  if (reasons.length === 0) {
    return <div className="text-sm text-[var(--text-secondary)]">No recorded failure reasons.</div>;
  }
  
  const maxCount = Math.max(...reasons.map((r) => r.count));

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-widget)] backdrop-blur-md p-4 shadow-lg">
      {reasons.slice(0, 10).map((reason) => (
        <div key={reason.reason} className="flex items-center gap-3">
          <div className="w-32 truncate text-sm text-[var(--text-primary)]" title={reason.reason}>
            {reason.reason}
          </div>
          <div className="flex-1">
            <div 
              className="h-4 rounded bg-[var(--status-delayed)]" 
              style={{ width: `${Math.max((reason.count / maxCount) * 100, 2)}%` }} 
            />
          </div>
          <div className="w-8 text-right text-sm text-[var(--text-secondary)]">
            {reason.count}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/FailureReasonsChart.tsx
git commit -m "feat(frontend): add failure reasons breakdown chart component"
```

### Task 5: Integrate into Dashboard Page

**Files:**
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `ExecutiveKPIs`, `FailureReasonsChart`, `fetchExecutiveStats`

- [ ] **Step 1: Import new components and queries**

In `frontend/app/page.tsx`, add the new imports at the top:
```tsx
import { fetchSummaryStats, fetchPeakComparison, fetchTrend, fetchIncidents, fetchExecutiveStats } from '@/lib/queries';
import type { ExecutiveStats } from '@/lib/queries';
import { ExecutiveKPIs } from '@/components/ExecutiveKPIs';
import { FailureReasonsChart } from '@/components/FailureReasonsChart';
```
*(Make sure to remove the old `fetchSummaryStats...` import and the `StatTiles` import if they conflict, or replace them).*

- [ ] **Step 2: Add execStats to DashboardData**

Update `DashboardData` interface:
```typescript
interface DashboardData {
  stats: StatusPercentages;
  peakComparison: PeakComparisonRow[];
  trend: TrendPoint[];
  incidents: Incident[];
  execStats: ExecutiveStats;
}
```

- [ ] **Step 3: Update fetch call**

Inside `load()`, update the `Promise.all`:
```typescript
        const [stats, peakComparison, trend, incidents, execStats] = await Promise.all([
          fetchSummaryStats(client, range),
          fetchPeakComparison(client, range),
          fetchTrend(client, range),
          fetchIncidents(client, range),
          fetchExecutiveStats(client, range),
        ]);
        if (!cancelled) {
          setData({ stats, peakComparison, trend, incidents, execStats });
        }
```

- [ ] **Step 4: Update JSX layout**

Replace the `<section>` containing `<StatTiles percentages={data.stats} />` with:
```tsx
          {config.visibleWidgets.statTiles && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Executive KPIs</h2>
              <ExecutiveKPIs percentages={data.stats} execStats={data.execStats} />
            </section>
          )}

          {config.visibleWidgets.statTiles && data.execStats.reasons.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Failure Reasons Breakdown</h2>
              <FailureReasonsChart reasons={data.execStats.reasons} />
            </section>
          )}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(frontend): integrate executive KPIs and failure reasons chart into dashboard"
```
