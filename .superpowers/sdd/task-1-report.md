# Task 1 Report: Add Static Schedule Data & Helper

## Summary of Implementation
Implemented static schedule parsing for Barking Riverside train tracker poller.
- Created `poller/schedule.json` containing static departure and arrival timetable rules for weekdays, Saturdays, and Sundays (effective from 2026-05-17).
- Updated `poller/src/types.ts` to allow `rtt_uid: string | null` on `ScheduledServiceRow` since initial static schedule rows do not have an `rtt_uid` assigned.
- Implemented `getScheduledServicesForDate(serviceDate: string): ScheduledServiceRow[]` in `poller/src/schedule.ts`, converting timetable London local time strings into ISO UTC timestamps, identifying peak periods, and assigning default pending status.
- Implemented unit tests in `poller/test/schedule.test.ts` verifying service generation for weekday and Sunday dates.

## TDD Evidence

### RED Phase
- **Command:** `npx vitest run test/schedule.test.ts`
- **Output:**
  ```
  FAIL  test/schedule.test.ts [ test/schedule.test.ts ]
  Error: Failed to load url ../src/schedule.js (resolved id: ../src/schedule.js) in .../poller/test/schedule.test.ts. Does the file exist?
  ```
- **Explanation:** The test failed as expected because `poller/src/schedule.ts` had not been created yet.

### GREEN Phase
- **Command:** `npx vitest run test/schedule.test.ts`
- **Output:**
  ```
  ✓ test/schedule.test.ts (2 tests) 40ms
  Test Files  1 passed (1)
       Tests  2 passed (2)
  ```
- **Explanation:** Implementation in `poller/src/schedule.ts` satisfies test expectations.

### Full Suite Verification
- **Command:** `npx vitest run`
- **Output:**
  ```
  Test Files  9 passed (9)
       Tests  61 passed (61)
  ```
- **Output Status:** Pristine, no warnings or errors.

## Files Changed
- `poller/schedule.json` (created)
- `poller/src/schedule.ts` (created)
- `poller/src/types.ts` (modified: allowed `rtt_uid: string | null`)
- `poller/test/schedule.test.ts` (created)

## Self-Review Findings
- **Completeness:** Meets all requirements in Task 1 specification.
- **Quality:** Follows NodeNext ES modules conventions and clean modular structure matching existing poller codebase patterns.
- **Discipline:** No extraneous code or overbuilding.
- **Testing:** TDD cycle followed cleanly, unit tests pass deterministically.

## Issues / Concerns
None.

## Code Review Findings & Fixes (Post-Review Update)

### Reviewer Feedback Addressed
1. **Timezone Safety Fix in `poller/src/schedule.ts`**: Replaced `date.getDay()` with `date.getUTCDay()` so day of week calculation for UTC date strings (`YYYY-MM-DD`) does not shift depending on the local system timezone.
2. **Additional Test Coverage in `poller/test/schedule.test.ts`**: Added explicit test case for Saturday schedule generation (`2026-08-08`).

### Post-Review Verification Evidence
- **Schedule Tests Command:** `npx vitest run test/schedule.test.ts`
- **Output:**
  ```
  ✓ test/schedule.test.ts (3 tests) 53ms
  Test Files  1 passed (1)
       Tests  3 passed (3)
  ```
- **Full Suite Command:** `npx vitest run`
- **Output:**
  ```
  Test Files  9 passed (9)
       Tests  62 passed (62)
  ```
- **Status:** All 62 tests passing, output pristine.

