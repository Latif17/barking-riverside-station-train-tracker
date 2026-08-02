# Realtime Trains API Polling Optimization Design

## Problem
The poller currently exceeds the Realtime Trains API rate limits. The API token restricts usage to:
- 10 requests per minute
- 100 requests per hour
- 1,000 requests per day

The previous architecture made 2 API calls per tick (fetching 00:00-12:00 and 12:00-23:59 separately) every 20 seconds during peak periods. This exhausted the hourly rate limit in less than 20 minutes and heavily exceeded the daily budget.

## Solution
We will adopt a **Unified "End of Day" Strategy**, heavily subsidizing aggressive peak-hour polling by sleeping completely overnight and slowing down off-peak. Because the RTT API supports up to 23h59m time windows, we can consolidate data fetching into **1 API call per tick**.

### Architecture
Every tick, the poller will make exactly one request to `/rtt/location`:
- `timeFrom`: `[now - 30 minutes]` (to catch recently departed trains and feed into the force-resolve fallback)
- `timeTo`: `23:59` today (to catch all upcoming trains and advance cancellations)

### Polling Budget (Daily)
The script will run on a dynamic timer based on the time of day:
- **Sleep Period (01:00 to 05:00)**: Script pauses completely. 
  - `0 calls/day`
- **Peak Period (6 hours total)**: Poll every **40 seconds** (1.5 calls/min). 
  - `540 calls/day`
- **Off-Peak Period (14 hours total)**: Poll every **2 minutes** (0.5 calls/min). 
  - `420 calls/day`
- **Total**: 960 calls/day (Safely under the 1,000 limit).

## Implementation Details

1. **`peakPeriod.ts`**
   - Add a `'sleep'` state to the `PeakPeriod` type.
   - Update `computePeakPeriod(date)` to return `'sleep'` if the time is between 01:00 and 05:00.

2. **`config.ts`**
   - Update `pollIntervalPeakMs` to `40000`.
   - Update `pollIntervalOffPeakMs` to `120000`.
   - Add a new `pollIntervalSleepMs` set to `60000` (checks every minute during sleep to see if sleep period is over) or compute exact delay until 05:00.

3. **`rttClient.ts`**
   - Refactor `fetchTodayRows` to make a single call to `fetchLocationWindow`.
   - Compute `timeFrom = now - 30 mins` and `timeTo = end of today (23:59)`.

4. **`index.ts`**
   - Update the `tick` logic to support the new `sleep` period, applying the correct delay.
