# RTT Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accurately track departures and forecast-based delays without grace periods by generating multiple DB rows per RTT service.

**Architecture:** Update the data mapping function to extract both arrival and departure blocks as an array, removing the 3-minute grace period, and processing delay status based on forecast lateness before `realtimeActual` is populated.

**Tech Stack:** TypeScript, Vitest

## Global Constraints
- Grace period is strictly 0 minutes (any lateness > 0 is delayed).
- Map both arrival and departure into separate rows for a single service.

---

### Task 1: Update Mapping Logic and Tests

**Files:**
- Modify: `poller/src/rttClient.ts`
- Modify: `poller/test/rttClient.test.ts`

**Interfaces:**
- Consumes: Existing `RttService` types and fixture data.
- Produces: `mapRttServiceToRows` (formerly `mapRttServiceToRow`) which returns `ScheduledServiceRow[]`.

- [ ] **Step 1: Write failing test for mapping both directions and 0-minute threshold**

Modify `poller/test/rttClient.test.ts` to expect an array of rows and handle the 0-minute threshold:

```typescript
// In poller/test/rttClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mapRttServiceToRows, fetchTodayRows } from '../src/rttClient.js';
import { londonTimeToUtcIso } from '../src/dateHelpers.js';
import { computePeakPeriod } from '../src/peakPeriod.js';
import { createTokenProvider } from '../src/rttAuth.js';
import fixture from './fixtures/rttLocation.json' with { type: 'json' };

const [cancelledArrival, delayedDeparture, onTimeArrival, pendingDeparture] = fixture.services;

function makeTokenProvider() {
  return createTokenProvider(
    { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-abc' },
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'access-abc', validUntil: '2026-07-31T23:59:59Z' }),
    }) as unknown as typeof fetch,
  );
}

describe('mapRttServiceToRows', () => {
  it('maps a cancelled arrival', () => {
    const rows = mapRttServiceToRows(cancelledArrival);
    expect(rows).toEqual([{
      service_date: '2026-07-31',
      direction: 'arriving',
      scheduled_time: '2026-07-31T07:04:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T07:04:00.000Z')),
      status: 'cancelled',
      observed_time: null,
      delay_minutes: 0,
      rtt_uid: 'gb-nr:L01500:2026-07-31',
    }]);
  });

  it('maps a delayed departure using realtimeAdvertisedLateness directly', () => {
    const rows = mapRttServiceToRows(delayedDeparture);
    expect(rows).toEqual([{
      service_date: '2026-07-31',
      direction: 'departing',
      scheduled_time: '2026-07-31T07:18:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T07:18:00.000Z')),
      status: 'delayed',
      observed_time: '2026-07-31T07:23:12.000Z',
      delay_minutes: 5,
      rtt_uid: 'gb-nr:L01525:2026-07-31',
    }]);
  });

  it('maps a 1-minute delay as delayed due to 0-minute threshold', () => {
    // onTimeArrival has realtimeAdvertisedLateness = 1 in the fixture
    const rows = mapRttServiceToRows(onTimeArrival);
    expect(rows[0]?.status).toBe('delayed');
    expect(rows[0]?.delay_minutes).toBe(1);
  });

  it('maps a not-yet-run service as pending', () => {
    const rows = mapRttServiceToRows(pendingDeparture);
    expect(rows).toEqual([{
      service_date: '2026-07-31',
      direction: 'departing',
      scheduled_time: '2026-07-31T09:03:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T09:03:00.000Z')),
      status: 'pending',
      observed_time: null,
      delay_minutes: 0,
      rtt_uid: 'gb-nr:L01545:2026-07-31',
    }]);
  });

  it('returns empty array for a service with neither arrival nor departure scheduled', () => {
    expect(mapRttServiceToRows({ temporalData: {} })).toEqual([]);
  });
});

// Update the describe('fetchTodayRows', ...) block to use the newly named mapRttServiceToRows implicitly since it tests fetchTodayRows directly. No other test changes needed except ensuring expect(rows).toHaveLength(4) still passes.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poller && npx vitest run test/rttClient.test.ts`
Expected: Compilation errors or test failures because `mapRttServiceToRows` is not defined.

- [ ] **Step 3: Write minimal implementation**

Modify `poller/src/rttClient.ts`. Remove `DELAY_THRESHOLD_MINUTES`, update mapping to return an array of rows, and update `fetchTodayRows` to `flatMap`.

```typescript
// In poller/src/rttClient.ts
import { computePeakPeriod } from './peakPeriod.js';
import { londonTimeToUtcIso } from './dateHelpers.js';
import type { Direction, ScheduledServiceRow } from './types.js';
import type { TokenProvider } from './rttAuth.js';

export interface RttIndividualTemporalData {
  scheduleAdvertised?: string;
  realtimeActual?: string;
  realtimeForecast?: string;
  realtimeAdvertisedLateness?: number;
  isCancelled?: boolean;
}

export interface RttService {
  scheduleMetadata?: {
    uniqueIdentity?: string;
  };
  temporalData?: {
    arrival?: RttIndividualTemporalData | null;
    departure?: RttIndividualTemporalData | null;
  };
}

interface RttLocationResponse {
  services?: RttService[];
}

export interface RttClientConfig {
  rttBaseUrl: string;
  rttStationCode: string;
}

function directionsAndBlocks(
  service: RttService,
): Array<{ direction: Direction; block: RttIndividualTemporalData }> {
  const results: Array<{ direction: Direction; block: RttIndividualTemporalData }> = [];
  
  const arrival = service.temporalData?.arrival;
  if (arrival?.scheduleAdvertised) {
    results.push({ direction: 'arriving', block: arrival });
  }

  const departure = service.temporalData?.departure;
  if (departure?.scheduleAdvertised) {
    results.push({ direction: 'departing', block: departure });
  }

  return results;
}

export function mapRttServiceToRows(service: RttService): ScheduledServiceRow[] {
  const blocks = directionsAndBlocks(service);
  if (blocks.length === 0) return [];
  
  return blocks.map(({ direction, block }) => {
    const scheduled_time = new Date(block.scheduleAdvertised!).toISOString();
    const service_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
      new Date(scheduled_time),
    );
    const peak_period = computePeakPeriod(new Date(scheduled_time));
    const rtt_uid = service.scheduleMetadata?.uniqueIdentity ?? null;
    const delay_minutes = block.realtimeAdvertisedLateness ?? 0;

    let status: 'pending' | 'on_time' | 'delayed' | 'cancelled' = 'pending';
    
    if (block.isCancelled) {
      status = 'cancelled';
    } else if (delay_minutes > 0) {
      status = 'delayed';
    } else if (block.realtimeActual) {
      status = 'on_time';
    }

    return {
      service_date,
      direction,
      scheduled_time,
      peak_period,
      status,
      observed_time: block.realtimeActual ? new Date(block.realtimeActual).toISOString() : null,
      delay_minutes,
      rtt_uid,
    };
  });
}

// Keep fetchLocationWindow as is...
async function fetchLocationWindow(
  config: RttClientConfig,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fromHhmm: string,
  toHhmm: string,
  fetchFn: typeof fetch,
): Promise<RttService[]> {
  const timeFrom = londonTimeToUtcIso(serviceDate, fromHhmm);
  const timeTo = londonTimeToUtcIso(serviceDate, toHhmm);
  const url = `${config.rttBaseUrl}/rtt/location?code=${config.rttStationCode}&timeFrom=${timeFrom}&timeTo=${timeTo}`;

  const request = (token: string) => fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });

  let token = await tokenProvider.getAccessToken();
  let response = await request(token);

  if (response.status === 401) {
    token = await tokenProvider.forceRefresh();
    response = await request(token);
  }

  if (response.status === 204) return [];
  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable body>');
    throw new Error(
      `RTT location request failed with status ${response.status} for ${url}: ${body}`,
    );
  }

  const body = (await response.json()) as RttLocationResponse;
  return body.services ?? [];
}

export async function fetchTodayRows(
  config: RttClientConfig,
  tokenProvider: TokenProvider,
  serviceDate: string,
  fetchFn: typeof fetch = fetch,
): Promise<ScheduledServiceRow[]> {
  const services = await fetchLocationWindow(
    config,
    tokenProvider,
    serviceDate,
    '00:00',
    '23:59',
    fetchFn,
  );

  return services.flatMap(mapRttServiceToRows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poller && npm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add poller/src/rttClient.ts poller/test/rttClient.test.ts
git commit -m "feat: accurate RTT departure tracking and 0-minute delay threshold"
```
