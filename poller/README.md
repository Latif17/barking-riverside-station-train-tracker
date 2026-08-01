# Barking Riverside Poller

Polls the Realtime Trains (RTT) next-generation API for services calling at
Barking Riverside station (CRS code `BGV`), and records on-time/delayed/
cancelled outcomes to Supabase.

## Setup

1. Apply the database migrations to your Supabase project: open the SQL
   Editor in the Supabase dashboard and run, in order, `0001_init.sql`,
   `0002_set_updated_at_trigger.sql`, and `0003_rtt_migration.sql` (repo root,
   `supabase/migrations/`) — or apply them from the repo root with the
   Supabase CLI, e.g. `supabase db push`. The poller will fail on its first
   cycle without the `scheduled_services` table and its RTT-shaped columns.
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (from your Supabase project's API settings),
   and `RTT_REFRESH_TOKEN` (from your RTT next-generation API account —
   sign up at https://api-portal.rtt.io).

There's no schedule file to maintain: RTT's `/rtt/location` response for
Barking Riverside is itself the schedule, sourced from the real Network Rail
timetable, so genuine timetable changes are picked up automatically.

## Running locally

    npm install
    npm start

Set `DRY_RUN=true` to log intended changes without writing to Supabase.

## Running in Docker (homelab)

    docker compose up -d --build

Check logs with `docker compose logs -f`.

## Running tests

    npm test
