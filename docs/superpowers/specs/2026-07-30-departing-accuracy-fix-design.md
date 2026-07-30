# Departing-Direction Accuracy Fix — Design

**Date:** 2026-07-30
**Status:** Approved for planning

## Purpose

Phase 1 (see `2026-07-29-train-tracker-phase1-design.md`) matches live TfL
`StopPoint/910GBARKRIV/Arrivals` predictions against the fixed schedule to
determine whether each scheduled service ran on time, was delayed, or was
cancelled. Validating this against real data (2026-07-30) found the
**arriving** direction (trains terminating at Barking Riverside) is accurate,
but the **departing** direction (trains heading out towards Gospel Oak) is
not, for two reasons:

1. **Duplicate vehicle matching** (fixed 2026-07-30, same day as this
   design): `fetchPendingRows` only returned rows with `status = 'pending'`,
   so once a row resolved, its `vehicle_id` was forgotten and the same
   physical train could be credited to a second scheduled slot minutes later
   — impossible given the line's 30+ minute one-way trip time. Fixed by
   having the poller also fetch rows resolved in the last
   `VEHICLE_REUSE_COOLDOWN_MS` (20 min) purely so their `vehicle_id` stays
   visible to the existing dedup check in `pollCycle.ts`.
2. **Systematic early bias (~7–10 min), still open — this design fixes it.**
   Barking Riverside is a terminus. Live testing (3 polls, 90s apart) found
   TfL's Arrivals feed at this stop essentially never carries a
   Gospel-Oak-destined ("departing") prediction in advance — it only appears
   fleetingly, right as the train reverses at the platform. The app was
   measuring that reassignment moment, not the real departure some minutes
   later after dwell time, biasing every departing "on_time"/"delayed"
   reading early by roughly the dwell time.

## Data source decision

Barking (`910GBARKING`), the very next stop after Barking Riverside towards
Gospel Oak, was checked live and confirmed to carry stable, advance-notice
predictions for Suffragette line services in both directions — unlike the
terminus feed. Cross-checking 6 vehicles present in both feeds gave a
consistent **~7 minute** running time between Barking Riverside and Barking
(range 6:44–7:00).

TfL's per-vehicle endpoint (`/Vehicle/{id}/Arrivals`) was evaluated and
**ruled out** as a separate polling target: it only returns a vehicle's
*upcoming* stops, so it cannot retroactively confirm a vehicle was at Barking
Riverside once that leg has passed, and Barking's own stop-arrivals feed
already gives everything needed (per-vehicle, per-direction, with lead time).
Adding it would be redundant complexity for no extra accuracy.

## Key constraint: short-formed services

Some Suffragette services terminate at Barking and never reach Barking
Riverside (confirmed by the project owner as a real, recurring pattern, not
an edge case). This means:

- A vehicle appearing in Barking's outbound (Gospel-Oak-bound) feed is **not
  sufficient on its own** to prove it departed Barking Riverside — it may
  have started its outbound working at Barking itself.
- Conversely, a service that terminates at Barking and never reaches Barking
  Riverside is, from Barking Riverside's perspective, a real no-show for
  that scheduled arrival — reported as `cancelled`, same as a true no-show.
  No new status is introduced; the existing 3-state model
  (`on_time`/`delayed`/`cancelled`) is kept as-is.

## Matching algorithm

A pending **departing** row is only resolved using a vehicle sighting from
Barking's outbound feed if that vehicle can be linked back to a prior,
independent confirmation of physical presence at Barking Riverside:

1. **BR-presence check.** A `vehicleId` counts as "confirmed at Barking
   Riverside" if it appears with that id on *any* row (arriving or
   departing) for today or yesterday's `service_date`, with a
   `last_seen_at`/`observed_time` within `VEHICLE_REUSE_COOLDOWN_MS` (20 min)
   of the current poll. This reuses the existing recently-resolved-rows
   mechanism from the same-day duplicate-match fix — every row from the BR
   terminus feed carries `naptanId = 910GBARKRIV` regardless of which
   direction it matched, so both arriving and departing-blip rows are valid
   proof of presence.
2. **Barking outbound sighting.** Poll `StopPoint/910GBARKING/Arrivals`,
   filtered to `lineId = suffragette` and `destinationNaptanId =
   910GGOSPLOK`. For each such prediction, check step 1 for its `vehicleId`.
   - **Linked:** treat this as the real departure event. Estimated actual
     departure time = Barking's `expectedArrival` minus the fixed ~7 minute
     run-time constant. Feed this into the existing nearest-pending-slot
     matching logic (same direction, tolerance window) in place of the old
     terminus-blip timestamp.
   - **Not linked** (no BR-presence record): ignore this sighting for
     BR-departure purposes — it's a Barking-originated short working, not a
     Barking Riverside departure.
3. **Cancellation** is unchanged: a departing row with no linked match by its
   15-minute grace deadline (`CANCELLATION_GRACE_MS`) is marked `cancelled`.

The existing terminus-blip match (destinationNaptanId = Gospel Oak, seen
briefly at Barking Riverside itself) is kept only as one valid source of
"BR-presence" evidence (step 1) — it is no longer used as the timing source
for departure delay/on-time calculations, since Barking's signal is strictly
more stable for that purpose.

## Architecture change

```
┌──────────────────────┐
│  Homelab (Docker)    │
│  poller script       │
│  polls TfL Arrivals  │──▶ StopPoint/910GBARKRIV/Arrivals  (arriving direction; BR-presence evidence)
│  + fixed schedule    │──▶ StopPoint/910GBARKING/Arrivals   (departing direction confirmation, NEW)
└──────────────────────┘
```

- New `poller/src/barkingClient.ts`, mirroring `tflClient.ts`: fetches
  `StopPoint/910GBARKING/Arrivals`, filters to `lineId = suffragette` and
  `destinationNaptanId = 910GGOSPLOK`, returns the same `TflPrediction`
  shape already used elsewhere.
- `pollCycle.ts` gains a `BARKING_RIVERSIDE_TO_BARKING_RUN_MS` constant
  (~7 min) and the BR-presence-linking step described above. The pure
  function's inputs grow by one array (Barking-outbound predictions); its
  existing signature for BR-terminus predictions and pending/recently-resolved
  rows is unchanged.
- `index.ts` adds one more `Promise.all` fetch (Barking arrivals) alongside
  the existing TfL Arrivals and Supabase reads.
- No schema change. No frontend change.

## Testing

- Unit tests for `barkingClient.ts` (fetch + filter logic), mirroring
  `tflClient.test.ts`.
- Unit tests for the new linking logic in `pollCycle.test.ts`: a
  Barking-outbound sighting with a matching recent BR-presence row resolves
  the departing slot; one without any BR-presence row is ignored; the
  existing duplicate-vehicle dedup and cancellation-grace tests continue to
  pass unchanged.
- No live API calls in tests — fixture data only, consistent with existing
  poller tests.

## Explicitly out of scope

- Per-vehicle endpoint (`/Vehicle/{id}/Arrivals`) — evaluated and ruled out
  above.
- A distinct "short-formed"/"terminated early" status — reported as
  `cancelled`, per project owner decision.
- Any change to the arriving-direction matching logic, which is already
  accurate.
- Backfilling or reclassifying already-stored historical rows using the new
  logic — this design only changes how future poll cycles resolve pending
  rows.
