# Early Trains Tracking Design

## Objective
Track trains that arrive or depart early from Barking Riverside station by recording their precise deviation from the schedule, without distorting existing on-time performance metrics.

## Approach
Currently, the system clamps early train deviations to `0` minutes of delay using `Math.max(0, lateness)`. We will remove this clamping to allow negative values for `delay_minutes` (e.g., `-2` representing 2 minutes early).

## Architecture & Changes

### 1. Poller Adjustments
- **`poller/src/rttClient.ts`**: Update `mapRttServiceToRows` to remove the `Math.max(0, ...)` clamp when computing `delay_minutes` from the RTT feed's `realtimeAdvertisedLateness`. 
- **`poller/src/index.ts`**: Update the `pollOnce` function to remove the `Math.max(0, ...)` clamp when calculating adjusted delays (`row.delay_minutes = Math.max(0, scheduleShiftMinutes + rttDelay)`).

### 2. Data Integrity & State
- The `status` enum for trains arriving or departing early will continue to resolve to `'on_time'`.
- The database schema for `delay_minutes` is already an `integer` and natively supports negative values.

### 3. Frontend Dashboard
- Because early trains remain tagged with an `'on_time'` status, the existing frontend data aggregation correctly groups them into the "On Time" metrics alongside trains that arrived perfectly on schedule. No frontend code needs to change.

## Testing & Validation
- Ensure unit tests (if any) in the poller correctly pass negative values when the observed time precedes the scheduled time. 
- Validate that `status` falls back to `'on_time'` properly when negative lateness values are encountered.
