# Barking Riverside Train Tracker — Dashboard

Public dashboard showing how often trains at Barking Riverside are cancelled
or delayed, with peak-time comparison. Reads directly from Supabase (the
`scheduled_services` table populated by the poller in `../poller/`).

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in your Supabase
   project's URL and **anon public key** (Project Settings → API in the
   Supabase dashboard) — not the service_role key, which must never appear
   in frontend code.
2. `npm install`

## Running locally

    npm run dev

Open http://localhost:3000. The printable report is at http://localhost:3000/report.

## Deploying to Vercel

1. Push this repo to GitHub (if not already).
2. In the Vercel dashboard, "Add New Project", import the repo, and set the
   **Root Directory** to `frontend`.
3. Add the two environment variables from `.env.local.example` (with real
   values) in the Vercel project's Environment Variables settings.
4. Deploy — Vercel auto-detects Next.js and the free tier is sufficient for
   this project's traffic.

## Running tests

    npm test
