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
- TfL Unified API is free and requires no auth for the endpoints used here.

## TfL API findings (verified against live API on 2026-07-29)

- Station StopPoint id for Barking Riverside: `910GBARKRIV`. Line id: `suffragette`.
- `/StopPoint/910GBARKRIV/Arrivals` returns live predictions per train
  (`vehicleId`, `platformName`, `expectedArrival`, `timeToStation`, etc.) but
  **has no field indicating cancellation.**
- `/Line/suffragette/Status` returns only line-wide severity (e.g. "Good
  Service"), not per-train status — not granular enough to detect an individual
  cancelled service on an otherwise-fine line.
- **Conclusion: cancellation must be inferred** by comparing the scheduled
  timetable against what's actually observed in Arrivals over time. There is no
  shortcut via a status flag.
- `/Line/suffragette/Timetable/910GBARKRIV` is expected to provide the scheduled
  departures needed to seed each day's expected services, but its exact response
  shape (direction/day-type handling) has not yet been verified — **first
  implementation task is a research spike against this endpoint** before writing
  the seed job.

## Architecture

```
┌──────────────────────┐         ┌────────────────────┐         ┌───────────────────────┐
│  Homelab (Docker)    │  writes │                     │  reads  │  Next.js on Vercel    │
│  poller script       │────────▶│  Supabase Postgres  │────────▶│  (dashboard frontend)  │
│  polls TfL API       │ service │  (+ RLS policies)   │  anon   │                        │
└──────────────────────┘  role   └────────────────────┘  key    └───────────────────────┘
         │
         ▼
   TfL Unified API
   (Line/suffragette/*, StopPoint/910GBARKRIV/*)
```

- **Poller** (homelab, Docker container): the only component that talks to TfL and
  the only one with write access to Supabase. Uses a Supabase **service-role
  key**, which never leaves the homelab environment.
- **Supabase**: Postgres + Row-Level Security. The **anon key** (used by the
  frontend) is granted `SELECT` only — no insert/update/delete policy exists for
  it, so even a leaked anon key can't be used to write fake data.
- **Frontend** (Vercel, free tier): Next.js app querying Supabase directly via the
  Supabase JS client. No custom backend/API layer on Vercel — keeps the app
  entirely within free-tier function-invocation limits and reduces moving parts.
  (Considered adding a Next.js API layer as a middle tier; rejected as
  unnecessary complexity for the current scope.)

## Data model (Supabase Postgres)

```sql
create table scheduled_services (
  id              uuid primary key default gen_random_uuid(),
  service_date    date not null,
  direction       text not null check (direction in ('towards_barking', 'towards_gospel_oak')),
  scheduled_time  timestamptz not null,
  destination     text,                  -- e.g. "Barking", "Gospel Oak"
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
  Mon–Fri; everything else (including weekends) is `off_peak`. Precomputing keeps
  dashboard queries simple (no time-math per read).
- `status` starts as `pending` and is updated by the poller as trains are
  observed or the cancellation grace period elapses.
- The `unique` constraint makes re-running the daily seed job a safe no-op.
- RLS: `anon` role → `SELECT` only. Service role (poller) → full read/write.

## Poller (Docker container, homelab)

**Daily seed job** (once per service day):
1. Call `/Line/suffragette/Timetable/910GBARKRIV` for both directions.
2. Insert one `scheduled_services` row per scheduled departure with `peak_period`
   computed from `scheduled_time`.

**Polling loop** (every 30–60s during service hours):
1. Fetch `/StopPoint/910GBARKRIV/Arrivals`.
2. Match each arrival to a `pending` row (same direction, closest `scheduled_time`
   within a tolerance window); record `vehicle_id`.
3. When a matched train's `timeToStation` reaches ~0 (i.e. it arrives), set
   `status` to `on_time` or `delayed`, and fill in `observed_time` and
   `delay_minutes`.
4. Sweep pass: any `pending` row whose `scheduled_time` + grace period (e.g. 15
   minutes) has elapsed with no match → `status = cancelled`.

**Resilience:** TfL API errors/timeouts are logged and retried on the next cycle.
A missed poll doesn't lose data — matching happens against the timetable over
many cycles, not a single snapshot, so coarser timing on one cycle just means a
later cycle catches the match.

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

- Poller: unit tests for the pure logic (arrival-matching algorithm,
  peak-period computation) using fixture data captured from real TfL API
  responses (already verified during design — see "TfL API findings" above). No
  live API calls in tests.
- Before enabling writes, run the poller in a dry-run/log-only mode against real
  TfL data for a full day to sanity-check matching logic.
- Frontend: component-level tests for widgets against mock Supabase data.

## Explicitly out of scope for Phase 1

- Notifications (SMS/Twitter/etc.) when a morning train is cancelled — Phase 2.
- User accounts / cross-device settings sync.
- Server-generated PDF reports (using browser print instead).
- Configurable peak-time windows per user (using a fixed standard definition).
