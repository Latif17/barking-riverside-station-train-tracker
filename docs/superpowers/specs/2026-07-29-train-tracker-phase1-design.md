# Barking Riverside Train Tracker — Phase 1 Design

**Date:** 2026-07-29
**Status:** Approved for planning

## Purpose

Track how often trains at Barking Riverside Overground station (Suffragette line)
are cancelled or delayed, with particular attention to peak commute times. The
resulting record is intended to be credible enough to present as evidence to the
Mayor of London's office about service reliability.

This document covers **Phase 1**: the data collection pipeline and the public
dashboard. Phase 2 (fast notifications — SMS/Twitter/etc. when a morning train is
cancelled) is out of scope here and will get its own design once Phase 1's data
pipeline is running, since it can build directly on the `scheduled_services` table
and the poller's detection logic defined below.

## Constraints

- Must be free to run. Vercel free tier only allows daily cron jobs, which is far
  too coarse for this use case — so the poller runs outside Vercel entirely.
- The user has a homelab and will run the poller there as a Docker container, with
  full control over polling frequency.
- The Realtime Trains (RTT) "Next Generation" API is free for personal,
  non-commercial use but requires registering an account at `api-portal.rtt.io`
  and requesting a bearer token. **The legacy `api.rtt.io` API is being
  decommissioned 2026-09-30** — this design targets only the new API
  (spec: `realtimetrains.github.io/api-specification`).
- RTT's terms require the API token to never be embedded in a distributable /
  public-facing application — it must stay server-side. This is a hard
  constraint on the architecture: the public Vercel frontend can never call RTT
  directly, and RTT enforces its own rate limits (minute/hour/day/week), so a
  predictable, low-frequency homelab poller is the right shape regardless of the
  Supabase caching benefits below.

## Data source findings (verified 2026-07-29)

- Barking Riverside's National Rail station code (CRS) is **`BGV`**, confirmed
  via nationalrail.co.uk. This is a real, independent station code, distinct
  from the TfL StopPoint id — RTT/Darwin identify stations by CRS code, not by
  TfL's `naptanId`.
- **TfL's own API does not carry Overground timetable data.**
  `/Line/suffragette/Timetable/{stopPointId}` returns 404 for both Barking
  Riverside and Gospel Oak, while the same endpoint shape works for a Tube line
  (verified with `victoria`) — confirming this isn't a wrong-id mistake, TfL
  simply doesn't publish it for Overground. This ruled out the original
  TfL-arrivals-heuristic approach entirely: without a schedule, there's nothing
  to compare live arrivals against.
- **RTT's Next Generation API gives scheduled + actual + cancellation data
  directly, per service, in one call** — no heuristic needed. Endpoint:
  `GET /gb-nr/location?code=BGV&...` (bearer auth). Key response shape
  (`components/schemas` in the RTT spec):
  - Each service has `scheduleMetadata` (`uniqueIdentity`, `departureDate`,
    `operator`, `inPassengerService`) and a `locations` array (stops along the
    route), each with `locationMetadata` (`platform`, `line`) and
    `temporalData: { arrival, departure, pass }`.
  - Each of `arrival`/`departure` (`IndividualTemporalData`) carries:
    `scheduleAdvertised` (booked time), `realtimeActual` (actual time, if it's
    happened), `realtimeAdvertisedLateness` (delay in minutes),
    **`isCancelled: boolean`** (set directly by RTT/Darwin — no inference
    needed), and `cancellationReasonCode`.
  - Since Barking Riverside is a terminus, each service's `locations` entry for
    BGV will have only `departure` populated (service starting here, heading to
    Gospel Oak) or only `arrival` populated (service terminating here, having
    come from Gospel Oak) — this is what drives the `direction` field below.
  - Bonus for the future notification use case: `isCancelled` can flip to true
    as soon as Network Rail announces a cancellation, which may be well before
    the scheduled time — faster detection than any grace-period heuristic could
    achieve.

## Architecture

```
┌──────────────────────┐         ┌────────────────────┐         ┌───────────────────────┐
│  Homelab (Docker)    │  writes │                     │  reads  │  Next.js on Vercel    │
│  poller script       │────────▶│  Supabase Postgres  │────────▶│  (dashboard frontend)  │
│  polls RTT API       │ service │  (+ RLS policies)   │  anon   │                        │
└──────────────────────┘  role   └────────────────────┘  key    └───────────────────────┘
         │
         ▼
   Realtime Trains API (api-portal.rtt.io)
   GET /gb-nr/location?code=BGV
```

- **Poller** (homelab, Docker container): the only component that talks to RTT
  (bearer token stays in the homelab environment, per RTT's terms) and the only
  one with write access to Supabase, via a Supabase **service-role key**.
- **Supabase's role has changed from the original plan**: since RTT already
  computes scheduled/actual/cancellation data, Supabase is no longer doing any
  inference — it's a caching + historical-archive layer. It's still needed
  because (a) the RTT token can never be exposed to the public frontend, (b) RTT
  rate-limits API access in a way that's incompatible with unpredictable public
  dashboard traffic, and (c) an independent archive protects against RTT API
  changes (they're already mid-migration off the legacy API).
  Postgres + Row-Level Security: the **anon key** (frontend) is granted
  `SELECT` only — no insert/update/delete policy exists for it.
- **Frontend** (Vercel, free tier): Next.js app querying Supabase directly via
  the Supabase JS client. No custom backend/API layer on Vercel.

## Data model (Supabase Postgres)

```sql
create table scheduled_services (
  id                    uuid primary key default gen_random_uuid(),
  rtt_service_uid       text not null,        -- scheduleMetadata.uniqueIdentity
  service_date          date not null,        -- scheduleMetadata.departureDate
  direction             text not null check (direction in ('departing', 'arriving')),
  scheduled_time        timestamptz not null, -- temporalData.{arrival,departure}.scheduleAdvertised
  peak_period           text not null check (peak_period in ('am_peak', 'pm_peak', 'off_peak')),
  status                text not null default 'pending'
                          check (status in ('pending', 'on_time', 'delayed', 'cancelled')),
  observed_time          timestamptz,          -- realtimeActual, once populated
  delay_minutes          int,                  -- realtimeAdvertisedLateness
  cancellation_reason    text,                 -- cancellationReasonCode, if cancelled
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (rtt_service_uid, service_date, direction)
);

create index on scheduled_services (service_date, peak_period);
create index on scheduled_services (status);
```

Notes:
- `peak_period` is computed from `scheduled_time` at first-seen time, using
  standard weekday commute windows: AM peak ~06:30–09:30, PM peak ~16:00–19:00,
  Mon–Fri; everything else (including weekends) is `off_peak`. Precomputing keeps
  dashboard queries simple (no time-math per read).
- `status` starts as `pending` (service hasn't happened yet) and is set directly
  from RTT's own fields on each poll: `isCancelled = true` → `cancelled`;
  `realtimeActual` populated → `on_time` (lateness ≤ 0) or `delayed`
  (lateness > 0); otherwise stays `pending`.
- The `unique` constraint on `(rtt_service_uid, service_date, direction)` makes
  every poll an upsert — safe to re-run, no separate seed/update distinction
  needed.
- RLS: `anon` role → `SELECT` only. Service role (poller) → full read/write.

## Poller (Docker container, homelab)

Unlike the original TfL-based design, there's no separate "seed the day's
timetable, then match live arrivals against it" split — RTT's response already
contains schedule + actual + cancellation together, so every poll is the same
operation:

**Polling loop** (every 2–5 minutes; exact interval to be tuned once real RTT
rate limits are confirmed after registering — see Task 1 in the implementation
plan):
1. Call `GET /gb-nr/location?code=BGV&date=<today>` (bearer token from env).
2. For each returned service, find its `locations` entry for `code = BGV` and
   read whichever of `arrival`/`departure` is populated — this determines
   `direction` (`departure` populated → `departing`; `arrival` populated →
   `arriving`).
3. Upsert into `scheduled_services` on `(rtt_service_uid, service_date,
   direction)`: set `scheduled_time` from `scheduleAdvertised` (first time seen
   only — it shouldn't change), and `status`/`observed_time`/`delay_minutes`/
   `cancellation_reason` from the logic above (re-evaluated every poll, since
   `isCancelled` and `realtimeActual` can change between polls as the day
   progresses).

**Resilience:** RTT API errors/timeouts (including 429 rate-limit responses,
which include a `Retry-After` header) are logged and retried with backoff —
never crash the container. A missed poll doesn't lose data, since the next poll
re-fetches the full current state for the day, not a delta.

## Frontend / Dashboard

- **Stack:** Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel free
  tier. Supabase JS client for all data access.
- **Widgets** (each queries `scheduled_services` independently and fails
  independently — a broken widget doesn't take down the page):
  - **Stat tiles** — on-time %, delayed %, cancelled % for the selected date range.
  - **Peak vs off-peak comparison** — bar chart, AM peak / PM peak / off-peak side
    by side.
  - **Trend over time** — daily/weekly cancellation rate line chart.
  - **Recent cancellations table** — date, time, direction; a concrete log rather
    than just aggregate stats.
- **Configuration:** browser-local only (`localStorage`, no login/accounts) —
  date range (7/30/90 days or custom) and which widgets are shown. No
  drag-and-drop layout editing in v1 (YAGNI — can be added later if actually
  wanted).
- **Peak highlighting:** peak-period bars/rows get a distinct, consistent visual
  treatment throughout the dashboard.
- **Report/export view:** a dedicated `/report` route, print-optimized CSS,
  summarizing stats for the selected date range. User exports via the browser's
  native "Print to PDF" — no PDF-generation library or server-side rendering
  needed, keeping this fully within the free-tier constraint.

## Error handling

- Poller: TfL API failures → retry with backoff, log, never crash the container.
- Supabase write failures → retry with backoff; persistent failures land in
  Docker logs (no external alerting infra for Phase 1).
- Duplicate-seed protection via the schema's `unique` constraint.
- Frontend: each widget handles its own loading/empty/error state independently.

## Testing

- Poller: unit tests for the pure logic (status derivation from
  `isCancelled`/`realtimeActual`, direction detection, peak-period computation)
  using fixture JSON matching the RTT schema documented above. No live API
  calls in tests.
- Before enabling writes, run the poller in a dry-run/log-only mode against real
  RTT data for a full day to sanity-check the upsert logic.
- Frontend: component-level tests for widgets against mock Supabase data.

## Explicitly out of scope for Phase 1

- Notifications (SMS/Twitter/etc.) when a morning train is cancelled — Phase 2.
- User accounts / cross-device settings sync.
- Server-generated PDF reports (using browser print instead).
- Configurable peak-time windows per user (using a fixed standard definition).
