# Early Trains Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track when trains depart early and display this as a distinct metric in the frontend.

**Architecture:** Introduce an `'early'` status across the stack. Store exact negative lateness in the database, updating poller derivation logic. Add a dedicated "Early" UI tile with aggregation in the frontend.

**Tech Stack:** TypeScript, Node.js, React (Next.js), Supabase (PostgreSQL), Vitest

## Global Constraints

- Database row-level security (RLS) is unchanged.
- The `early` status will seamlessly fit into the existing daily aggregation logic, ensuring total percentages always equal 100%.

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260802095800_add_early_status.sql`

**Interfaces:**
- Consumes: N/A
- Produces: Updates `scheduled_services` `status` check constraint.

- [ ] **Step 1: Write the SQL migration**

```sql
-- supabase/migrations/20260802095800_add_early_status.sql
alter table scheduled_services drop constraint if exists scheduled_services_status_check;
alter table scheduled_services add constraint scheduled_services_status_check check (status in ('pending', 'on_time', 'delayed', 'cancelled', 'early'));
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase migration up` (or equivalent database setup script if available, e.g. `npm run db:push` / `npm run test` which might apply it). Let's use Supabase CLI or just create the file to be applied.
Actually, wait, if there's no direct CLI mentioned, just checking it syntax-wise.
Run: `npm -C frontend run test` (just to ensure it doesn't break anything immediately, although tests may not run DB).
Wait, let's just create the file and commit.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260802095800_add_early_status.sql
git commit -m "feat(db): add early status to scheduled_services check constraint"
```

### Task 2: Poller Logic Updates

**Files:**
- Modify: `poller/src/types.ts`
- Modify: `poller/src/rttClient.ts`
- Modify: `poller/test/rttClient.test.ts`

**Interfaces:**
- Produces: `ScheduledServiceRow` with `status: 'early'` when lateness < 0.

- [ ] **Step 1: Write the failing test**

Add to `poller/test/rttClient.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { mapRttServiceToRows, RttService } from '../src/rttClient';

describe('mapRttServiceToRows (early)', () => {
  it('maps an early service correctly', () => {
    const service: RttService = {
      scheduleMetadata: { uniqueIdentity: 'early-123' },
      temporalData: {
        departure: {
          scheduleAdvertised: '2026-08-02T10:00:00Z',
          realtimeActual: '2026-08-02T09:58:00Z',
          realtimeAdvertisedLateness: -2,
        }
      }
    };
    const rows = mapRttServiceToRows(service);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('early');
    expect(rows[0].delay_minutes).toBe(-2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poller && npm run test -- rttClient`
Expected: FAIL (status expected 'early' but received 'on_time' or similar)

- [ ] **Step 3: Write minimal implementation**

In `poller/src/types.ts`:
```typescript
export type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled' | 'early';
```

In `poller/src/rttClient.ts`:
```typescript
// Replace: const delay_minutes = Math.max(0, block.realtimeAdvertisedLateness ?? 0);
// With:
const delay_minutes = block.realtimeAdvertisedLateness ?? 0;

// Replace status logic:
let status: 'pending' | 'on_time' | 'delayed' | 'cancelled' | 'early' = 'pending';

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poller && npm run test -- rttClient`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add poller/src/types.ts poller/src/rttClient.ts poller/test/rttClient.test.ts
git commit -m "feat(poller): track early departures with negative delay and early status"
```

### Task 3: Frontend Aggregation Updates

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/aggregate.ts`
- Modify: `frontend/test/aggregate.test.ts`

**Interfaces:**
- Produces: `StatusCounts` and `StatusPercentages` with `early` and `earlyPercent`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/test/aggregate.test.ts`:
```typescript
import { aggregateStatusCounts, toPercentages } from '../lib/aggregate';
import { expect, it, describe } from 'vitest';

describe('aggregate with early', () => {
  it('counts early services and calculates percentage', () => {
    const rows = [
      { status: 'on_time' },
      { status: 'early' },
      { status: 'delayed' },
      { status: 'early' },
    ];
    const counts = aggregateStatusCounts(rows);
    expect(counts.early).toBe(2);
    expect(counts.total).toBe(4);
    
    const percentages = toPercentages(counts);
    expect(percentages.earlyPercent).toBe(50);
    expect(percentages.total).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- aggregate.test`
Expected: FAIL (early does not exist on StatusCounts)

- [ ] **Step 3: Write minimal implementation**

In `frontend/lib/types.ts`:
```typescript
export type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled' | 'early';
```

In `frontend/lib/aggregate.ts`:
```typescript
export interface StatusCounts {
  onTime: number;
  delayed: number;
  cancelled: number;
  early: number;
  pending: number;
  total: number;
}

export interface StatusPercentages {
  onTimePercent: number;
  delayedPercent: number;
  cancelledPercent: number;
  earlyPercent: number;
  total: number;
}

export function aggregateStatusCounts(rows: { status: string }[]): StatusCounts {
  const counts: StatusCounts = { onTime: 0, delayed: 0, cancelled: 0, early: 0, pending: 0, total: 0 };
  for (const row of rows) {
    counts.total += 1;
    if (row.status === 'on_time') counts.onTime += 1;
    else if (row.status === 'delayed') counts.delayed += 1;
    else if (row.status === 'cancelled') counts.cancelled += 1;
    else if (row.status === 'early') counts.early += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function toPercentages(counts: StatusCounts): StatusPercentages {
  const resolved = counts.onTime + counts.delayed + counts.cancelled + counts.early;
  if (resolved === 0) {
    return { onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, earlyPercent: 0, total: 0 };
  }
  return {
    onTimePercent: (counts.onTime / resolved) * 100,
    delayedPercent: (counts.delayed / resolved) * 100,
    cancelledPercent: (counts.cancelled / resolved) * 100,
    earlyPercent: (counts.early / resolved) * 100,
    total: resolved,
  };
}
```
*Note: Update `aggregateByPeakPeriod` and `aggregateTrendByDate` similarly to include `counts.early` in `resolved` if they redeclare it locally.*

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- aggregate.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/aggregate.ts frontend/test/aggregate.test.ts
git commit -m "feat(frontend): support early status in aggregations"
```

### Task 4: Frontend UI Updates

**Files:**
- Modify: `frontend/components/StatTiles.tsx`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/test/StatTiles.test.tsx`

**Interfaces:**
- Consumes: `StatusPercentages` containing `earlyPercent`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/test/StatTiles.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatTiles } from '../components/StatTiles';

describe('StatTiles', () => {
  it('renders early stat tile', () => {
    const percentages = {
      onTimePercent: 50,
      delayedPercent: 20,
      cancelledPercent: 10,
      earlyPercent: 20,
      total: 100,
    };
    render(<StatTiles percentages={percentages} />);
    expect(screen.getByText('Left early')).toBeDefined();
    expect(screen.getByText('20%')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- StatTiles.test`
Expected: FAIL ("Left early" not found)

- [ ] **Step 3: Write minimal implementation**

In `frontend/app/globals.css`:
```css
:root {
  /* add these alongside existing status colors */
  --status-early: #14b8a6; /* Teal 500 */
}
```

In `frontend/components/StatTiles.tsx`:
```tsx
export function StatTiles({ percentages }: StatTilesProps) {
  // ... existing code ...
  return (
    <div>
      <div className="grid grid-cols-4 gap-3">
        <Tile label="On time" value={percentages.onTimePercent} colorVar="--status-on-time" />
        <Tile label="Left early" value={percentages.earlyPercent} colorVar="--status-early" />
        <Tile label="Delayed" value={percentages.delayedPercent} colorVar="--status-delayed" />
        <Tile label="Cancelled" value={percentages.cancelledPercent} colorVar="--status-cancelled" />
      </div>
      {/* ... */}
    </div>
  );
}
```
*Note: Ensure `grid-cols-4` replaces `grid-cols-3` to accommodate the 4th tile.*

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- StatTiles.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/StatTiles.tsx frontend/app/globals.css frontend/test/StatTiles.test.tsx
git commit -m "feat(frontend): display early departures in StatTiles"
```
