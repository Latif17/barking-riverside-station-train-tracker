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

- Must be free to run, with no ongoing API registration/credential dependency
  beyond what's already free and public.
- Vercel free tier only allows daily cron jobs, far too coarse for this use case
  — so the poller runs outside Vercel entirely, in the user's homelab, as a
  Docker container with full control over polling frequency.

## Data source decision (revised after live testing — see history below)

**Final decision: TfL Unified API only** (`/StopPoint/910GBARKRIV/Arrivals`),
matched against a **manually-curated, fixed schedule** checked into the poller
repo as a config file.

- TfL's Arrivals endpoint requires no registration and is confirmed working
  (tested live during design). It gives live predictions per train
  (`vehicleId`, `direction`, `destinationNaptanId`, `destinationName`,
  `expectedArrival`, `timeToStation`) but **no cancellation flag and no
  timetable** — `/Line/suffragette/Timetable/{stopPointId}` 404s for Overground
  (confirmed against both Barking Riverside and Gospel Oak, with a working Tube
  line as a control), so there is nothing built into TfL to compare live
  arrivals against.
- Because Barking Riverside is the **terminus** of the Suffragette line (Gospel
  Oak ↔ Barking Riverside), every service either **departs** towards Gospel Oak
  (`destinationNaptanId = 910GGOSPLOK`) or **arrives** from Gospel Oak and
  terminates here (`destinationNaptanId = 910GBARKRIV`) — this is the ground
  truth for the `direction` field, more reliable than TfL's own
  `direction: inbound/outbound` string, which didn't correspond to this
  cleanly in sample checks.
- The gap — no schedule to compare against — is filled with a **fixed,
  manually-maintained schedule**: since National Rail/Overground timetables only
  change a handful of times a year (May/December change dates), the user enters
  the current published departure/arrival times for Barking Riverside into a
  git-versioned config file once, and updates it on the rare occasions the
  timetable changes. This gives real scheduled times to compare live arrivals
  against without depending on any external timetable API.
- **Historical backfill is out of scope for Phase 1.** The record starts
  accumulating from when the poller first goes live.

### Why not RTT or Darwin/HSP (ruled out during design)

Two external UK rail data APIs were evaluated and ruled out:
- **Realtime Trains (RTT) Next Generation API** would have given
  scheduled + actual + explicit `isCancelled` per service in one call — but its
  auth was found to be broken in practice when tested live with a real
  registered token, and separately its historical window is only ~14 days, too
  shallow to be useful even if the auth worked.
- **National Rail Darwin (live, via raildata.org.uk) + HSP (historical)** are
  more established (Darwin is 15+ years old and is what nationalrail.co.uk's
  own live departure boards run on), but bring real friction for this project:
  a separate registration, a SOAP/XML API for the live half, and unresolved,
  conflicting documentation on how far back HSP's historical data actually
  goes. Given Phase 1 has dropped the historical-backfill requirement, the
  extra registration and integration complexity isn't justified — TfL alone,
  already proven working with zero registration, covers everything Phase 1
  needs.

This isn't a closed door: if Phase 2 or a future phase needs richer data
(explicit cancellation reasons, deeper history), Darwin/HSP remain the most
credible path and can be revisited then.

## Architecture

```
┌──────────────────────┐         ┌────────────────────┐         ┌───────────────────────┐
│  Homelab (Docker)    │  writes │                     │  reads  │  Next.js on Vercel    │
│  poller script       │────────▶│  Supabase Postgres  │────────▶│  (dashboard frontend)  │
│  polls TfL Arrivals  │ service │  (+ RLS policies)   │  anon   │                        │
│  + fixed schedule    │ role    │                     │  key    │                       │
└──────────────────────┘         └────────────────────┘         └───────────────────────┘
         │
         ▼
   TfL Unified API — StopPoint/910GBARKRIV/Arrivals
```

- **Poller** (homelab, Docker container): the only component with write access
  to Supabase, via a Supabase **service-role key** that never leaves the
  homelab. Holds the fixed-schedule config and does the matching.
- **Supabase**: Postgres + Row-Level Security. The **anon key** (frontend) is
  granted `SELECT` only — no insert/update/delete policy exists for it.
- **Frontend** (Vercel, free tier): Next.js app querying Supabase directly via
  the Supabase JS client. No custom backend/API layer on Vercel.

## Fixed schedule config

A git-versioned file in the poller project (e.g. `poller/schedule.json`),
listing scheduled times per direction and day-type, sourced by the user from
Barking Riverside's current published National Rail timetable:

```json
{
  "effective_from": "2026-07-29",
  "weekday": {
    "departing": ["05:32", "05:47", "06:02", "..."],
    "arriving":  ["05:55", "06:10", "06:25", "..."]
  },
  "saturday":  { "departing": ["..."], "arriving": ["..."] },
  "sunday":    { "departing": ["..."], "arriving": ["..."] }
}
```

- `effective_from` records when this version of the schedule was entered, for
  traceability if historical data ever needs reinterpreting after a timetable
  change.
- Updating this file (a few times a year) and redeploying the Docker container
  is the entire maintenance burden — no code changes needed.

## Data model (Supabase Postgres)

```sql
create table scheduled_services (
  id              uuid primary key default gen_random_uuid(),
  service_date    date not null,
  direction       text not null check (direction in ('departing', 'arriving')),
  scheduled_time  timestamptz not null,
  peak_period     text not null check (peak_period in ('am_peak', 'pm_peak', 'off_peak')),
  status          text not null default 'pending'
                    check (status in ('pending', 'on_time', 'delayed', 'cancelled')),
  observed_time   timestamptz,           -- actual arrival, if seen
  delay_minutes   int,                   -- observed_time - scheduled_time, in minutes
  vehicle_id      text,                  -- TfL vehicleId, if matched
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (service_date, direction, scheduled_time)
);

create index on scheduled_services (service_date, peak_period);
create index on scheduled_services (status);
```

Notes:
- `peak_period` is computed once at seed time from `scheduled_time`, using
  standard weekday commute windows: AM peak ~06:30–09:30, PM peak ~16:00–19:00,
  Mon–Fri; everything else (including weekends) is `off_peak`.
- `status` starts as `pending` and is updated by the poller as trains are
  observed or the cancellation grace period elapses.
- The `unique` constraint makes re-running the daily seed job a safe no-op.
- RLS: `anon` role → `SELECT` only. Service role (poller) → full read/write.

## Poller (Docker container, homelab)

**Daily seed job** (once per service day):
1. Look up today's day-type (weekday/Saturday/Sunday) and read the matching
   list of scheduled times from `schedule.json`.
2. Insert one `scheduled_services` row per scheduled time (both directions),
   with `peak_period` computed from `scheduled_time`.

**Polling loop** (every 30–60s during service hours):
1. Fetch `/StopPoint/910GBARKRIV/Arrivals`.
2. For each arrival, determine `direction` from `destinationNaptanId`
   (`910GGOSPLOK` → `departing`, `910GBARKRIV` → `arriving`), then match it to
   a `pending` row (same direction, closest `scheduled_time` within a
   tolerance window); record `vehicle_id`.
3. When a matched train's `timeToStation` reaches ~0 (i.e. it arrives), set
   `status` to `on_time` or `delayed`, and fill in `observed_time` and
   `delay_minutes`.
4. Sweep pass: any `pending` row whose `scheduled_time` + grace period (e.g. 15
   minutes) has elapsed with no match → `status = cancelled`.

**Resilience:** TfL API errors/timeouts are logged and retried on the next
cycle — never crash the container. A missed poll doesn't lose data, since
matching happens against the fixed schedule over many cycles, not a single
snapshot.

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

- Poller: unit tests for the pure logic (arrival-to-schedule matching
  algorithm, direction detection from `destinationNaptanId`, peak-period
  computation) using fixture data captured from real TfL API responses
  (verified during design). No live API calls in tests.
- Before enabling writes, run the poller in a dry-run/log-only mode against
  real TfL data for a full day to sanity-check matching logic against the
  fixed schedule.
- Frontend: component-level tests for widgets against mock Supabase data.

## Explicitly out of scope for Phase 1

- Notifications (SMS/Twitter/etc.) when a morning train is cancelled — Phase 2.
- User accounts / cross-device settings sync.
- Server-generated PDF reports (using browser print instead).
- Configurable peak-time windows per user (using a fixed standard definition).
- Historical backfill (e.g. to Jan 2024) — dropped after RTT/HSP evaluation;
  may be revisited in a future phase if a reliable free historical source is
  found.
