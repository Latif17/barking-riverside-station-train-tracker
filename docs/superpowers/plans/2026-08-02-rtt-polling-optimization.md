# RTT Polling Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a unified end-of-day API polling strategy to stay under RTT rate limits.

**Architecture:** We will modify `rttClient` to make 1 request per tick covering `00:00` to `23:59`. We will introduce a new `sleep` peak period from 01:00 to 05:00 and adjust polling intervals in configuration to fit the 1000 requests/day budget.

**Tech Stack:** TypeScript, Node.js, Vitest

## Global Constraints

- Must stay strictly under 1,000 API calls per day.
- Must execute exactly 1 `/location` call per tick unless in `sleep` mode (0 calls).

---

### Task 1: Add Sleep State to Peak Periods

**Files:**
- Modify: `poller/src/peakPeriod.ts`
- Modify: `poller/test/peakPeriod.test.ts`

**Interfaces:**
- Produces: `PeakPeriod` type union `am_peak | pm_peak | off_peak | sleep`
- Produces: `computePeakPeriod` returns `'sleep'` between 01:00 and 05:00.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to poller/test/peakPeriod.test.ts inside the describe block
  it('is sleep at 02:00 London time', () => {
    // 02:00 London (GMT)
    expect(computePeakPeriod(new Date('2026-01-05T02:00:00Z'))).toBe('sleep');
  });

  it('is sleep at 04:59 London time', () => {
    // 04:59 London (GMT)
    expect(computePeakPeriod(new Date('2026-01-05T04:59:00Z'))).toBe('sleep');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poller && npx vitest run test/peakPeriod.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Modify `poller/src/peakPeriod.ts`:
```typescript
export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak' | 'sleep';

const SLEEP_START_MIN = 1 * 60;    // 01:00
const SLEEP_END_MIN = 5 * 60;      // 05:00

// In computePeakPeriod, after minutesSinceMidnight is defined:
  if (minutesSinceMidnight >= SLEEP_START_MIN && minutesSinceMidnight < SLEEP_END_MIN) {
    return 'sleep';
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poller && npx vitest run test/peakPeriod.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add poller/src/peakPeriod.ts poller/test/peakPeriod.test.ts
git commit -m "feat: add sleep period between 01:00 and 05:00"
```

---

### Task 2: Update Config Intervals

**Files:**
- Modify: `poller/src/config.ts`
- Modify: `poller/test/config.test.ts`

**Interfaces:**
- Produces: `Config` interface with `pollIntervalSleepMs: number`

- [ ] **Step 1: Fix and update tests**

In `poller/test/config.test.ts`:
Replace references to `pollIntervalMs` with the actual peak/off-peak logic and add `pollIntervalSleepMs`.

```typescript
    expect(config.pollIntervalPeakMs).toBe(40000);
    expect(config.pollIntervalOffPeakMs).toBe(120000);
    expect(config.pollIntervalSleepMs).toBe(60000); // 1 minute checks during sleep
```
Remove `POLL_INTERVAL_MS` overrides in tests and replace with `POLL_INTERVAL_PEAK_MS` if testing overrides.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poller && npx vitest run test/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

In `poller/src/config.ts`:
```typescript
export interface Config {
  // ...
  pollIntervalPeakMs: number;
  pollIntervalOffPeakMs: number;
  pollIntervalSleepMs: number;
}

// In loadConfig return:
    pollIntervalPeakMs: process.env.POLL_INTERVAL_PEAK_MS
      ? Number(process.env.POLL_INTERVAL_PEAK_MS)
      : 40000,
    pollIntervalOffPeakMs: process.env.POLL_INTERVAL_OFF_PEAK_MS
      ? Number(process.env.POLL_INTERVAL_OFF_PEAK_MS)
      : 120000,
    pollIntervalSleepMs: process.env.POLL_INTERVAL_SLEEP_MS
      ? Number(process.env.POLL_INTERVAL_SLEEP_MS)
      : 60000,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poller && npx vitest run test/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add poller/src/config.ts poller/test/config.test.ts
git commit -m "chore: update polling intervals for new budget"
```

---

### Task 3: Unified RTT API Call

**Files:**
- Modify: `poller/src/rttClient.ts`
- Modify: `poller/test/rttClient.test.ts` (if it tests fetchTodayRows behavior)

**Interfaces:**
- Consumes: `londonTimeToUtcIso` or standard JS Dates.
- Produces: `fetchTodayRows` modified to query `-30 mins` to `23:59`.

- [ ] **Step 1: Update Tests**

Update `poller/test/rttClient.test.ts` if there are explicit assertions on 2 calls being made by `fetchTodayRows`. Adjust them to assert a single call with the correct `timeFrom` and `timeTo`. If tests are complex, adapt them to expect 1 `fetch` call per `fetchTodayRows`.

- [ ] **Step 2: Write minimal implementation**

In `poller/src/rttClient.ts`, replace `fetchTodayRows`:

```typescript
export async function fetchTodayRows(
  config: RttClientConfig,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fetchFn: typeof fetch = fetch,
): Promise<ScheduledServiceRow[]> {
  const fullDay = await fetchLocationWindow(config, tokenProvider, serviceDate, '00:00', '23:59', fetchFn);
  return fullDay.flatMap(mapRttServiceToRows);
}
```

*(Note: we can safely remove `fetchLocationWindow` if no longer used).*

- [ ] **Step 3: Run tests**

Run: `cd poller && npx vitest run test/rttClient.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add poller/src/rttClient.ts poller/test/rttClient.test.ts
git commit -m "feat: consolidate to single rolling window API call"
```

---

### Task 4: Integrate Sleep Period into Main Loop

**Files:**
- Modify: `poller/src/index.ts`

**Interfaces:**
- Consumes: `period === 'sleep'`

- [ ] **Step 1: Write implementation**

In `poller/src/index.ts`, modify `pollOnce` to bail out if we are sleeping:
```typescript
async function pollOnce(
  config: ReturnType<typeof loadConfig>,
  client: ReturnType<typeof createSupabaseClient>,
  tokenProvider: ReturnType<typeof createTokenProvider>,
) {
  const now = new Date();
  if (computePeakPeriod(now) === 'sleep') {
    return; // Skip polling entirely
  }

  const serviceDate = todayLondon();
// ...
```

In `poller/src/index.ts`, update `tick()` delay logic:
```typescript
        let interval = config.pollIntervalOffPeakMs;
        if (period === 'am_peak' || period === 'pm_peak') {
          interval = config.pollIntervalPeakMs;
        } else if (period === 'sleep') {
          interval = config.pollIntervalSleepMs;
        }

        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, interval - elapsed);
```

- [ ] **Step 2: Commit**

```bash
git add poller/src/index.ts
git commit -m "feat: handle sleep period to prevent polling"
```
