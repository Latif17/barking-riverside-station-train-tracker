# Barking Riverside Poller

Polls TfL's live Arrivals feed for Barking Riverside station, matches it
against `schedule.json`, and records on-time/delayed/cancelled outcomes to
Supabase.

## Setup

1. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (from your Supabase project's API settings).
2. Make sure `schedule.json` has real timetable data (see the file's
   `effective_from` field) — see "Updating the schedule" below.

## Running locally

    npm install
    npm start

Set `DRY_RUN=true` to log intended changes without writing to Supabase.

## Running in Docker (homelab)

    docker compose up -d --build

Check logs with `docker compose logs -f`.

## Updating the schedule

National Rail timetables change a few times a year (typically May and
December). When Barking Riverside's published timetable changes:

1. Look up the new timetable (nationalrail.co.uk journey planner for station
   code `BGV`, or the TfL Suffragette line page).
2. Update `schedule.json`'s `weekday`/`saturday`/`sunday` arrays and bump
   `effective_from` to the change date.
3. Redeploy: `docker compose up -d --build`.

No code changes or database migrations are needed for a schedule update.

## Running tests

    npm test
