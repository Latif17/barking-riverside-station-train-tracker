# Early Trains Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track early trains natively with an `'early'` status and negative `delay_minutes`, and visualize them explicitly on the frontend dashboard.

**Architecture:** 
1. Database: Update check constraints on the `status` column to allow `'early'`.
2. Poller: Stop clamping negative delays, pass them through, and map `delay_minutes < 0` to `'early'`.
3. Frontend: Aggregate early trains into new metrics and display them distinctly on the charts and tiles.

**Tech Stack:** Supabase (PostgreSQL), TypeScript, Node.js, Next.js, React, Vitest.

## Global Constraints
- Node 18+ syntax.
- All timestamps stay in UTC or are parsed carefully.
- Existing tests must be updated to pass.
- Color for early status should be a distinct blue (e.g., `#3b82f6`).

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260803112000_early_status.sql`

**Interfaces:**
- Consumes: Existing DB schema
- Produces: Updated schema allowing `'early'` status on `scheduled_services.status` and `upstream_status`.

- [ ] **Step 1: Write migration**

```sql
alter table scheduled_services drop constraint if exists scheduled_services_status_check;
alter table scheduled_services add constraint scheduled_services_status_check check (status in ('pending', 'on_time', 'early', 'delayed', 'cancelled'));

alter table scheduled_services drop constraint if exists scheduled_services_upstream_status_check;
alter table scheduled_services add constraint scheduled_services_upstream_status_check check (upstream_status in ('pending', 'on_time', 'early', 'delayed', 'cancelled'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add early status to db schema"
```

---

### Task 2: Poller Updates

**Files:**
- Modify: `poller/src/types.ts`
- Modify: `poller/src/rttClient.ts`
- Modify: `poller/src/index.ts`
- Modify: `poller/test/rttClient.test.ts`
- Modify: `poller/test/index.test.ts`

**Interfaces:**
- Produces: Data with negative `delay_minutes` and `'early'` status.

- [ ] **Step 1: Update type definitions**

In `poller/src/types.ts`, add `'early'` to `ServiceStatus`.

- [ ] **Step 2: Update rttClient logic and tests**

In `poller/src/rttClient.ts`, remove `Math.max(0, ...)` from `delay_minutes`. Update the status mapping logic:
```typescript
    const delay_minutes = block.realtimeAdvertisedLateness ?? 0;
    let status: 'pending' | 'on_time' | 'early' | 'delayed' | 'cancelled' = 'pending';

    if (block.isCancelled) {
      status = 'cancelled';
    } else if (delay_minutes > 0) {
      status = 'delayed';
    } else if (delay_minutes < 0) {
      status = 'early';
    } else if (block.realtimeActual) {
      status = 'on_time';
    }
```

Update `poller/test/rttClient.test.ts` to add a test for an early train mapping correctly to `-2` delay and `'early'` status. Run `cd poller && npx vitest run test/rttClient.test.ts` to ensure it passes.

- [ ] **Step 3: Update main poller and tests**

In `poller/src/index.ts`, remove `Math.max` for `row.delay_minutes`:
```typescript
      const rttTimeMs = new Date(bgvRow.scheduled_time).getTime();
      const scheduleShiftMinutes = Math.round((rttTimeMs - timeMs) / 60000);
      const rttDelay = bgvRow.delay_minutes ?? 0;
      row.delay_minutes = scheduleShiftMinutes + rttDelay;
```

*(Note: The main poller merges from DB/RTT but relies on the DB or RTT's already assigned `status`. If it has to create a status from a DB fallback, ensure no `Math.max` restricts negative values. The assignment logic `row.status = bgvRow.status` will now pass `'early'` naturally).*

Run `cd poller && npx vitest run test/index.test.ts`. Fix any broken mock data if needed.

- [ ] **Step 4: Commit**

```bash
git add poller
git commit -m "feat: track early trains in poller"
```

---

### Task 3: Frontend Data Aggregation

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/aggregate.ts`
- Modify: `frontend/test/aggregate.test.ts`
- Modify: `frontend/lib/chartGeometry.ts`

**Interfaces:**
- Produces: UI-ready grouped percentage data including `early` and `earlyPercent`.

- [ ] **Step 1: Update frontend types**

In `frontend/lib/types.ts`, add `'early'` to `ServiceStatus`.

- [ ] **Step 2: Update aggregate logic**

In `frontend/lib/aggregate.ts`:
- Update `StatusCounts` to include `early: number`.
- Update `StatusPercentages` to include `earlyPercent: number`.
- Initialize `early: 0` in counts.
- Add `else if (row.status === 'early') counts.early += 1;`.
- Update `resolved` to include `counts.early`.
- Calculate `earlyPercent`.

Update `frontend/test/aggregate.test.ts` and run `cd frontend && npm run test` to verify.

- [ ] **Step 3: Update chart geometry**

In `frontend/lib/chartGeometry.ts`:
- Update type references to include `'early'`.
- In the `segmentDefs` array, insert `['early', group.percentages.earlyPercent]` between `'onTime'` and `'delayed'`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib frontend/test
git commit -m "feat: add frontend data aggregation for early trains"
```

---

### Task 4: Frontend UI Updates

**Files:**
- Modify: `frontend/app/globals.css`
- Modify: `frontend/components/StatTiles.tsx`
- Modify: `frontend/components/PeakComparisonChart.tsx`
- Modify: `frontend/test/StatTiles.test.tsx`
- Modify: `frontend/test/PeakComparisonChart.test.tsx`

**Interfaces:**
- Consumes: New aggregated data fields.

- [ ] **Step 1: Add CSS variable**

In `frontend/app/globals.css`:
```css
  --status-early: #3b82f6;
```

- [ ] **Step 2: Update components**

In `frontend/components/StatTiles.tsx`, add a new `<Tile />` for "Early":
```tsx
        <Tile label="Early" value={percentages.earlyPercent} colorVar="--status-early" />
```

In `frontend/components/PeakComparisonChart.tsx`:
- Add `'early'` to `STATUS_COLOR_VAR` (mapped to `--status-early`).
- Add `'early'` to `STATUS_LABEL` (mapped to `'Early'`).
- Update the legend mapping to include `'early'`.
- Fix any TS type definitions that list the statuses manually.

- [ ] **Step 3: Update tests**

Update `frontend/test/StatTiles.test.tsx` and `frontend/test/PeakComparisonChart.test.tsx` to include `early` and `earlyPercent` in their mock data, and check that "Early" renders in the document.

Run `cd frontend && npm run test`.

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "feat: visualize early trains on dashboard"
```
