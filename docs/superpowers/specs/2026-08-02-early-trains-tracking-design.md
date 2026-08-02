# Early Trains Tracking Design

## 1. Overview
The goal is to track when trains depart early and display this as a distinct metric in the frontend. Currently, early trains are categorized as `on_time` with a lateness of `0`. We will introduce a new `early` status and store negative lateness to capture this.

## 2. Database Changes
We will create a new migration to update the `scheduled_services` table. 
- Drop the existing check constraint on the `status` column.
- Add a new check constraint that allows `'early'` in addition to the existing `'pending', 'on_time', 'delayed', 'cancelled'`.

## 3. Poller Changes
- **Types (`poller/src/types.ts`)**: Update `ServiceStatus` to include `'early'`.
- **RTT Client (`poller/src/rttClient.ts`)**:
  - Instead of applying `Math.max(0, lateness)`, capture the exact lateness from RTT (so early trains get negative `delay_minutes`).
  - Update the status derivation logic:
    - If `isCancelled`, status is `cancelled`.
    - If `lateness > 0`, status is `delayed`.
    - If `lateness < 0`, status is `early`.
    - Otherwise (if `realtimeActual` is present and lateness is exactly 0), status is `on_time`.

## 4. Frontend Changes
- **Types (`frontend/lib/types.ts`)**: Update `ServiceStatus` to include `'early'`.
- **Aggregation (`frontend/lib/aggregate.ts`)**:
  - Add `early` and `earlyPercent` to `StatusCounts` and `StatusPercentages`.
  - Update calculation logic so that `early` services contribute to the resolved total and their percentage is calculated correctly.
- **UI (`frontend/components/StatTiles.tsx`)**:
  - Add a new tile for "Early" trains, utilizing a new CSS variable (e.g., `--status-early` with a distinct color like teal or indigo) for its color.
- **CSS (`frontend/app/globals.css`)**: Define `--status-early` in the theme variables.
- **Tests**: Update test fixtures and specs in `aggregate.test.ts` and `StatTiles.test.tsx` to handle the new state.

## 5. Security & Constraints
- Database row-level security (RLS) is unchanged.
- The `early` status will seamlessly fit into the existing daily aggregation logic, ensuring total percentages always equal 100%.
