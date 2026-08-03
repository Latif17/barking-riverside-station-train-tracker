# Early Trains Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the tracking of early train deviations using negative delays without artificially clamping them to 0.

**Architecture:** Remove `Math.max(0, ...)` wrappers around `delay_minutes` calculation in both the RTT client parser and the main polling loop's schedule drift adjustment. Early trains will thus have negative `delay_minutes` while keeping their `status` as `'on_time'`.

**Tech Stack:** TypeScript, Node.js, Vitest.

## Global Constraints
- Node 18+ syntax.
- All timestamps stay in UTC or are parsed carefully.
- Existing tests must pass.
- Status for early trains remains `'on_time'`.

---

### Task 1: Update RTT Client parser

**Files:**
- Modify: `poller/src/rttClient.ts:60-63`
- Modify: `poller/test/rttClient.test.ts:50-57`

**Interfaces:**
- Consumes: `RttIndividualTemporalData.realtimeAdvertisedLateness`
- Produces: `ScheduledServiceRow` with potentially negative `delay_minutes`

- [ ] **Step 1: Write a failing test for early arrival**

Modify `poller/test/rttClient.test.ts` to add a test for a negative `realtimeAdvertisedLateness`.

```typescript
  it('maps a 2-minute early train with negative delay and on_time status', () => {
    const earlyService = {
      scheduleMetadata: { uniqueIdentity: 'gb-nr:L00000:2026-07-31', inPassengerService: true },
      temporalData: {
        arrival: { scheduleAdvertised: '2026-07-31T08:00:00.000Z', realtimeActual: '2026-07-31T07:58:00.000Z', realtimeAdvertisedLateness: -2 },
      },
    };
    const rows = mapRttServiceToRows(earlyService);
    expect(rows[0]?.status).toBe('on_time');
    expect(rows[0]?.delay_minutes).toBe(-2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poller && npx vitest run test/rttClient.test.ts`
Expected: FAIL because `delay_minutes` is expected to be `-2` but receives `0` due to `Math.max(0, ...)`.

- [ ] **Step 3: Write minimal implementation**

In `poller/src/rttClient.ts`, modify the `delay_minutes` assignment (around line 62):

```typescript
    const delay_minutes = block.realtimeAdvertisedLateness ?? 0;
```

*(Ensure the subsequent `status` logic still uses `delay_minutes > 0` for `'delayed'`, which correctly bypasses negative delays to evaluate as `'on_time'` via `block.realtimeActual`)*.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poller && npx vitest run test/rttClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add poller/src/rttClient.ts poller/test/rttClient.test.ts
git commit -m "fix: allow negative delay minutes in rttClient for early trains"
```

---

### Task 2: Update Main Poller shift adjustment

**Files:**
- Modify: `poller/src/index.ts:97-101`

**Interfaces:**
- Consumes: `ScheduledServiceRow` with potentially negative `delay_minutes`

- [ ] **Step 1: Write minimal implementation**

In `poller/src/index.ts`, modify the assignment of `row.delay_minutes` inside `pollOnce` (around line 101) to remove `Math.max`:

```typescript
      // Adjust delay_minutes to account for the shift from the expected static schedule
      const rttTimeMs = new Date(bgvRow.scheduled_time).getTime();
      const scheduleShiftMinutes = Math.round((rttTimeMs - timeMs) / 60000);
      const rttDelay = bgvRow.delay_minutes ?? 0;
      row.delay_minutes = scheduleShiftMinutes + rttDelay;
```

- [ ] **Step 2: Run all tests to verify they pass**

Run: `cd poller && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add poller/src/index.ts
git commit -m "fix: remove delay clamp in poller adjustment for early trains"
```
