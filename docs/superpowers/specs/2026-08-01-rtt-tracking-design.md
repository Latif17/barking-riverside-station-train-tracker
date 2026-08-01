# Barking Riverside Train Tracker Design

## Purpose
Currently, the tracker prioritizes arrival data over departure data for trains that both arrive and depart (like at a terminus station). Additionally, it waits until a train has actually run before marking it as delayed, and uses a 3-minute grace period. We need to accurately track departures, capture delays ahead of time based on forecasts, and remove the grace period.

## Approach

### 1. Track Both Directions
- **Current**: `directionAndBlock` returns only the arrival block if both exist.
- **New**: Replace with `directionsAndBlocks(service)` which returns an array containing the arrival block (if present) and the departure block (if present).
- `mapRttServiceToRow` will be updated to handle an array of blocks, mapping each one to a separate `ScheduledServiceRow`.
- `fetchTodayRows` will use `flatMap` instead of `map` so that a single service can yield two database rows (one for arriving, one for departing) which will be safely upserted without constraint violations (since `direction` is part of the unique key).

### 2. Update Delay Logic
- **Current Threshold**: `DELAY_THRESHOLD_MINUTES = 3`.
- **New Threshold**: Remove the grace period. Any lateness (`realtimeAdvertisedLateness > 0`) is considered `delayed`.
- **Forecast-Aware Status**: The status evaluation will be updated to:
  1. If `isCancelled` is true, status is `cancelled`.
  2. If `realtimeAdvertisedLateness > 0`, status is `delayed` (whether it has run yet or is just forecasted).
  3. If it is not delayed and `realtimeActual` is present, status is `on_time`.
  4. Otherwise (no lateness forecasted and hasn't actually run yet), status is `pending`.

## Affected Files
- `poller/src/rttClient.ts`: Update mapping logic and remove `DELAY_THRESHOLD_MINUTES`.
- `poller/test/rttClient.test.ts`: Update tests to cover multiple directions per service and the new 0-minute delay threshold logic.
