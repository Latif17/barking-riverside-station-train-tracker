# Poller Data Source Migration: TfL Arrivals → Realtime Trains (RTT) — Design

**Date:** 2026-07-31
**Status:** Approved for planning

## Purpose

The current cancellation/delay tracking (TfL Arrivals feed + a manually-maintained
`schedule.json` + a vehicle-matching heuristic engine in `pollCycle.ts`) isn't
producing accurate results. This document replaces that entire approach with the
Realtime Trains (RTT) "next-generation" API, which reports scheduled time,
actual/forecast time, and an explicit cancellation flag per service directly —
removing the need to infer any of that from a live-positions-only feed.

This supersedes the "Data source decision" section of
`2026-07-29-train-tracker-phase1-design.md`, which evaluated and rejected RTT.
That rejection was based on the **legacy** `api.rtt.io` product (broken auth in
practice, Basic Auth only). The next-generation API at `data.rtt.io` is a
different product with working bearer-token auth (confirmed against the live
OpenAPI spec at `https://realtimetrains.github.io/api-specification/`) and the
user now holds a working long-life refresh token for it.

## Why RTT fixes the root cause, not just symptoms

TfL's Arrivals feed only gives live vehicle positions — no schedule, no
cancellation flag. Every piece of complexity in the current poller
(`MATCH_TOLERANCE_MS`, `VEHICLE_REUSE_COOLDOWN_MS`, the Barking-relay 7-minute
run-time correction, `CANCELLATION_GRACE_MS`, `FORCE_RESOLVE_MS`) exists solely
to work around that gap, by inferring schedule adherence from vehicle presence/
absence over time. RTT's `/rtt/location` endpoint returns, per service, the
scheduled time (`scheduleAdvertised`), the actual/forecast time
(`realtimeActual`/`realtimeForecast`), an explicit `isCancelled` boolean, and a
precomputed lateness figure (`realtimeAdvertisedLateness`) — so none of that
inference is needed. This also fixes a real accuracy gap: RTT can flag
`isCancelled` as soon as Network Rail announces it (often *before* the
scheduled time), whereas the current system can only infer a cancellation 15
minutes *after* a train fails to show.

## Decisions made

- **Full replacement, not hybrid.** TfL is dropped entirely — `tflClient.ts`,
  `barkingClient.ts`, and `direction.ts` are deleted. RTT is the sole data
  source for both schedule and live status.
- **`schedule.json` is retired.** RTT's response for a service day is itself
  the schedule (sourced from the real Network Rail timetable), so scheduled
  times no longer need manual maintenance 2-3 times a year and automatically
  reflect genuine timetable changes or short-notice alterations.

## Architecture

```
┌──────────────────────┐         ┌────────────────────┐         ┌───────────────────────┐
│  Homelab (Docker)    │  writes │                     │  reads  │  Next.js on Vercel    │
│  poller script       │────────▶│  Supabase Postgres  │────────▶│  (dashboard frontend)  │
│  polls RTT /location │ service │  (+ RLS policies)   │  anon   │                        │
└──────────────────────┘ role    └────────────────────┘         └───────────────────────┘
         │
         ▼
   RTT next-gen API — GET https://data.rtt.io/rtt/location?code=BGV
```

The Supabase schema, RLS policy shape, and frontend are unaffected beyond the
column changes below — this is purely a poller-internals + schema-tidy change.

## Auth (`poller/src/rttAuth.ts`, new)

- `RTT_REFRESH_TOKEN` env var, alongside the existing `SUPABASE_*` vars.
- An in-memory `{ accessToken, validUntil }` cache. Before each RTT call,
  refresh via `GET /api/get_access_token` (refresh token sent as the Bearer
  token) if there's no cached token or `validUntil` is within a 60-second
  buffer of now.
- On an unexpected `401` from a data call, force one refresh and retry once
  before letting the poll cycle fail (existing "log and retry next cycle"
  resilience policy applies beyond that).

## Fetching & mapping (`poller/src/rttClient.ts`, new)

- `GET /rtt/location?code=BGV&timeFrom=<iso>&timeTo=<iso>` with the Bearer
  access token. RTT caps a single query window at 23h59m, so a full service
  day is covered in **two calls** (e.g. 00:00–12:00 and 12:00–23:59 London
  time), both issued every poll cycle so upcoming/not-yet-run services show as
  `pending` immediately and cancellations surface as soon as RTT knows them —
  not just ones close to "now".
- For each service in the combined response, map to a `ScheduledServiceRow`:
  - **direction**: `temporalData.arrival` populated → `arriving`;
    `temporalData.departure` populated → `departing`. (BGV is a terminus, so a
    service has one or the other, never both — no destination-naptan
    inference needed.)
  - **scheduled_time**: `scheduleAdvertised` from the relevant block.
  - **status**: `isCancelled` on that block → `cancelled`; else
    `realtimeActual` present → `on_time`/`delayed` via RTT's own
    `realtimeAdvertisedLateness` against the existing 3-minute threshold; else
    still `pending`.
  - **observed_time** / **delay_minutes**: `realtimeActual` /
    `realtimeAdvertisedLateness` directly, no projection math.
  - **rtt_uid**: `scheduleMetadata.uniqueIdentity` (e.g.
    `gb-nr:L01525:2026-07-31`) — a stable reference id for debugging, not used
    for any matching/dedup logic (RTT already disambiguates services itself).
  - **peak_period**: unchanged, computed from `scheduled_time` via the
    existing `peakPeriod.ts`.

## Poller loop (`poller/src/index.ts`, rewritten)

RTT's response is authoritative for the whole day, so the loop no longer needs
a separate daily-seed step, a pending/resolved row fetch, or a "changed rows"
diff against prior state:

1. Fetch both RTT windows for today (service day derived from London calendar
   date, same `todayLondon()` helper as today).
2. Map every returned service to a row (as above).
3. Upsert all rows via the natural unique key
   (`service_date, direction, scheduled_time`) — idempotent by construction,
   so no existence checks are needed first.

`yesterdayLondon()` and the pending/resolved-row-carryover logic are removed:
there's no stateful matching to carry across a midnight boundary anymore, since
each cycle re-derives full status from RTT rather than accumulating vehicle
sightings.

**Behavior change accepted:** `service_date` for a row is simply the calendar
date of its own `scheduled_time`. The old `schedule.json` bucketed each day's
very last arrival (e.g. weekday's `00:11`) under the *previous* day's stats,
since it's effectively that service day's last train. Under RTT this one
train per day will instead count towards the following calendar date's stats.
Given it's a single service out of ~140/day, this is accepted as a minor,
known simplification rather than something worth extra logic to preserve.

As a safety net for the case where RTT itself has no data for a scheduled
service long after it was due (rather than reporting it cancelled) — a
narrower version of today's `FORCE_RESOLVE_MS` — a row still `pending` more
than 30 minutes after its `scheduled_time` with no RTT data at all is marked
`cancelled`. This is a fallback for RTT gaps, not the primary detection path.

## Database changes (new migration `0003_rtt_migration.sql`)

- Rename `vehicle_id` → `rtt_uid` (same `text`, nullable).
- Drop `last_seen_time_to_station` and `last_seen_at` — both existed only to
  support the TfL vehicle-matching heuristics being removed.
- No frontend code references any of these columns (confirmed by grep), so
  this is a clean rename/drop with no downstream impact.

## Config (`poller/src/config.ts`)

- Remove `tflStopPointId`, `barkingStopPointId`, `tflLineId`.
- Add `rttBaseUrl` (default `https://data.rtt.io`), `rttStationCode` (`'BGV'`),
  `rttRefreshToken` (required env, same pattern as
  `requireEnv('SUPABASE_SERVICE_ROLE_KEY')`).

`.env.example` gains `RTT_REFRESH_TOKEN=your-refresh-token`.

## Error handling

- RTT request failures (network error, non-2xx other than a handled 401):
  logged, retried next cycle, never crash the container — same policy as
  today.
- `429 Too Many Requests`: respect the `Retry-After` header before the next
  attempt rather than hammering the endpoint at the fixed poll interval.
  Concrete rate-limit numbers aren't published in the spec text (only
  response headers), so `POLL_INTERVAL_MS` may need tuning once live traffic
  against the real token shows actual limits — noted as a follow-up, not a
  blocker for this design.
- Supabase write failures: unchanged (retry with backoff, log; no external
  alerting infra).

## Testing

Same philosophy as today: fixture-based unit tests using a captured real
`/rtt/location` JSON response (to be captured live once the refresh token is
wired up), no live API calls in tests. New: `rttAuth.test.ts` (token cache/
refresh-on-expiry logic, mocked `fetch`), `rttClient.test.ts` (response →
row-mapping logic, including the direction/status/cancellation rules above).

## Files removed

- `poller/src/tflClient.ts`, `poller/src/barkingClient.ts`,
  `poller/src/direction.ts`, `poller/src/schedule.ts`
- `poller/schedule.json`
- `poller/test/tflClient.test.ts`, `poller/test/barkingClient.test.ts`,
  `poller/test/direction.test.ts`, `poller/test/schedule.test.ts`
- `poller/test/fixtures/arrivals.json`,
  `poller/test/fixtures/barkingArrivals.json`

## Files added

- `poller/src/rttAuth.ts`, `poller/src/rttClient.ts`
- `poller/test/rttAuth.test.ts`, `poller/test/rttClient.test.ts`
- `poller/test/fixtures/rttLocation.json`
- `supabase/migrations/0003_rtt_migration.sql`

## Files changed

- `poller/src/index.ts` — rewritten poll loop (see above).
- `poller/src/pollCycle.ts` — removed; its logic is replaced by the mapping
  function in `rttClient.ts`, plus a 30-minute force-resolve safety net that
  lives in `index.ts`'s poll loop.
- `poller/src/repository.ts` — replace `fetchPendingRows`,
  `fetchRecentlyResolvedRows`, `insertSeedRows`, `rowsExistForDate`,
  `upsertRows` (by id) with a single `upsertScheduledServices(client, rows)`
  that upserts on the natural unique key.
- `poller/src/types.ts` — `ScheduledServiceRow`: `vehicle_id` → `rtt_uid`;
  remove `last_seen_time_to_station`, `last_seen_at`.
- `poller/src/dateHelpers.ts` — remove `yesterdayLondon` (no longer used);
  keep `todayLondon`.
- `poller/src/config.ts`, `poller/.env.example`, `poller/README.md` — updated
  for RTT setup instead of TfL/schedule.json maintenance instructions.

## Explicitly out of scope

- Historical backfill — RTT's 14-day history cap makes this a non-goal here,
  consistent with Phase 1's existing decision to drop backfill.
- Tuning the exact poll interval against real RTT rate limits — deferred until
  the refresh token is live and response headers are visible.
