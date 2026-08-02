# Dual-Station Upstream Tracking Design Spec

## 1. Overview
The current train tracker relies solely on data from the Barking Riverside (BGV) terminus. This leads to "ghost trains" when trains are delayed upstream or short-turned at Barking (BKG). By utilizing a second RTT API key, we will concurrently track Barking (BKG) to provide 100% visibility into upstream delays and cancellations, turning a reactive dashboard into a highly predictive notification system.

## 2. Architecture & Approach
We will use the **"Fat Row"** architecture. Since our static schedule (`schedule.json`) remains the absolute source of truth, one scheduled train equals exactly one row in the database. 
Instead of treating Barking as a separate entity, we will append the upstream Barking data directly to the existing Barking Riverside scheduled rows.

## 3. Database Schema Changes
The Supabase `scheduled_services` table will be expanded to include upstream context. 

**New Columns:**
- `upstream_status` (enum or text): `'pending' | 'on_time' | 'delayed' | 'cancelled'`
- `upstream_observed_time` (timestampz, nullable): The actual time it arrived/departed Barking.
- `upstream_delay_minutes` (int, nullable): How late the train was at Barking.

*Note: The existing `(service_date, direction, scheduled_time)` unique constraint remains exactly as is.*

## 4. Data Flow & Polling Logic
The poller will be updated to handle two concurrent API streams without violating rate limits.

1. **Configuration:**
   - Add `RTT_REFRESH_TOKEN_2` (and optionally a second `rttBaseUrl2` if necessary for account separation, though standard tokens can just be rotated) to `config.ts`.
   - Create two instances of `tokenProvider`.

2. **Fetching Data:**
   - In `pollOnce`, initiate two concurrent `fetchTodayRows` calls:
     - **Call 1 (Key 1):** `fetchTodayRows(config, tokenProvider1, serviceDate, { code: 'gb-nr:BGV' })`
     - **Call 2 (Key 2):** `fetchTodayRows(config, tokenProvider2, serviceDate, { code: 'gb-nr:BKG', filterTo: 'gb-nr:BGV' })`
       *(Note: `filterTo` ensures we only process Barking trains heading to/from our branch).*

3. **Merging Data In-Memory:**
   - `fetchTodayRows` will be updated to return a raw map of RTT services rather than eagerly mapping them to the static schedule.
   - The main loop will iterate through the static `schedule.json` rows.
   - For each static row, it will:
     1. Look up the corresponding BGV service in the Key 1 data.
     2. Look up the corresponding BKG service in the Key 2 data.
     3. Populate the core columns with BGV data, and the `upstream_*` columns with BKG data.

4. **Force Resolve (Ghost Train Cleanup):**
   - The aggressive 30-minute timeout for ghost trains will apply to BOTH stations independently. If a train is 30 minutes late at Barking, its `upstream_status` becomes `cancelled`.

## 5. Edge Cases Addressed
- **Short-Turning:** If a train reaches Barking but terminates there, it will record an `upstream_status` of `on_time` or `delayed`, but a primary `status` of `cancelled` at Barking Riverside. This perfectly captures short-turns.
- **Freight / Non-Passenger Noise:** The newly implemented `inPassengerService === false` filter will apply to both API streams, ensuring freight passing through Barking doesn't corrupt the data.

## 6. Testing
- Existing tests will be updated to mock two token providers and two API responses.
- `fixtures/` will be expanded to include a mock response from Barking (BKG).
