# Early Trains Tracking Design

## Objective
Track trains that arrive or depart early from Barking Riverside station by recording their precise deviation from the schedule as a distinct `'early'` status, and visualizing this separately on the frontend dashboard.

## Approach
Currently, the system clamps early train deviations to `0` minutes of delay using `Math.max(0, lateness)` and logs them as `'on_time'`. We will remove this clamping, allow negative values for `delay_minutes` (e.g., `-2` representing 2 minutes early), and introduce an `'early'` status to represent this state explicitly.

## Architecture & Changes

### 1. Database Schema
- Create a new migration in `supabase/migrations` to alter the check constraint on `scheduled_services.status`. Update it to allow `'early'` in addition to the existing statuses (`'pending', 'on_time', 'delayed', 'cancelled'`).

### 2. Poller Adjustments
- **Types**: Update `ServiceStatus` in `poller/src/types.ts` to include `'early'`.
- **`poller/src/rttClient.ts`**: Remove the `Math.max(0, ...)` clamp. Assign `status = 'early'` if `delay_minutes < 0`.
- **`poller/src/index.ts`**: Remove the `Math.max(0, ...)` clamp when calculating adjusted delays. If the adjusted delay is less than 0, assign `status = 'early'` for the fallback DB logic, but since `rttClient` does most of the status assignments, just ensure negative delays are passed through properly without clamping.

### 3. Frontend Dashboard Updates
- **Data Aggregation**: Update `frontend/lib/aggregate.ts` to count `'early'` trains and calculate an `earlyPercent`. Update the `ServiceStatus` type in `frontend/lib/types.ts`.
- **Visuals**: Add a new color variable `--status-early` (e.g., a distinct blue) to `frontend/app/globals.css`.
- **Components**: 
  - Update `StatTiles.tsx` to display the new "Early" tile.
  - Update `PeakComparisonChart.tsx` and `chartGeometry.ts` to include the "Early" segment in the visualization stack.
  - Fix any tests in `frontend/test/` to accommodate the new `early` counts.
