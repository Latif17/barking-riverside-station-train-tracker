// poller/test/rttClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mapRttServiceToRows, fetchTodayRows } from '../src/rttClient.js';
import { getScheduledServicesForDate } from '../src/schedule.js';
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

  it('maps both arrival and departure when both are scheduled', () => {
    const dualService = {
      scheduleMetadata: { uniqueIdentity: 'gb-nr:L99999:2026-07-31' },
      temporalData: {
        arrival: { scheduleAdvertised: '2026-07-31T08:00:00.000Z', realtimeActual: '2026-07-31T08:00:00.000Z' },
        departure: { scheduleAdvertised: '2026-07-31T08:02:00.000Z', realtimeActual: '2026-07-31T08:02:00.000Z' },
      },
    };
    const rows = mapRttServiceToRows(dualService);
    expect(rows).toHaveLength(2);
    expect(rows[0].direction).toBe('arriving');
    expect(rows[1].direction).toBe('departing');
  });

  it('maps an overnight service with peak_period off_peak', () => {
    const sleepService = {
      scheduleMetadata: { uniqueIdentity: 'gb-nr:L01599:2026-07-31' },
      temporalData: {
        departure: { scheduleAdvertised: '2026-07-31T02:30:00.000Z' },
      },
    };
    const rows = mapRttServiceToRows(sleepService);
    expect(rows[0]?.peak_period).toBe('off_peak');
  });
});

describe('fetchTodayRows', () => {
  it('queries the location window and maps every returned service', async () => {
    const morningFrom = londonTimeToUtcIso('2026-07-31', '00:00');
    const morningTo = londonTimeToUtcIso('2026-07-31', '12:00');
    const eveningFrom = londonTimeToUtcIso('2026-07-31', '12:00');
    const eveningTo = londonTimeToUtcIso('2026-07-31', '23:59');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(`timeFrom=${morningFrom}`) && url.includes(`timeTo=${morningTo}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            services: [cancelledArrival, delayedDeparture, onTimeArrival, pendingDeparture],
          }),
        };
      }
      if (url.includes(`timeFrom=${eveningFrom}`) && url.includes(`timeTo=${eveningTo}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            services: [],
          }),
        };
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const rows = await fetchTodayRows(
      { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
      makeTokenProvider(),
      '2026-07-31',
      mockFetch as unknown as typeof fetch,
    );

    const expectedCount = getScheduledServicesForDate('2026-07-31').length;
    expect(rows).toHaveLength(expectedCount);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify one of the merged services from fixture
    const match = rows.find(r => r.rtt_uid === 'gb-nr:L01500:2026-07-31');
    expect(match).toBeDefined();
    expect(match?.status).toBe('cancelled');
  });

  it('retries once after a 401 by forcing a token refresh', async () => {
    let tokenCounter = 0;
    const tokenFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => {
        tokenCounter += 1;
        return { token: `access-${tokenCounter}`, validUntil: '2026-07-31T23:59:59Z' };
      },
    }));
    const tokenProvider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-abc' },
      tokenFetch as unknown as typeof fetch,
    );

    const firstAttemptAuth = new Map<string, string>();
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;

      if (!firstAttemptAuth.has(url)) {
        firstAttemptAuth.set(url, auth);
        return { ok: false, status: 401 };
      }
      expect(auth).not.toBe(firstAttemptAuth.get(url));
      return { ok: true, status: 200, json: async () => ({ services: [] }) };
    });

    const rows = await fetchTodayRows(
      { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
      tokenProvider,
      '2026-07-31',
      mockFetch as unknown as typeof fetch,
    );

    const expectedCount = getScheduledServicesForDate('2026-07-31').length;
    expect(rows).toHaveLength(expectedCount);
    expect(rows.every(r => r.status === 'cancelled')).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('treats a 204 response as no services', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

    const rows = await fetchTodayRows(
      { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
      makeTokenProvider(),
      '2026-07-31',
      mockFetch as unknown as typeof fetch,
    );

    const expectedCount = getScheduledServicesForDate('2026-07-31').length;
    expect(rows).toHaveLength(expectedCount);
    expect(rows.every(r => r.status === 'cancelled')).toBe(true);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(
      fetchTodayRows(
        { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
        makeTokenProvider(),
        '2026-07-31',
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/503/);
  });
});

describe('fetchTodayRows hybrid merge', () => {
  it('marks expected train as cancelled if missing from RTT', async () => {
    // Assuming '2026-08-02' has a departure at "08:48" (Sunday)
    // We mock fetchFn to return an empty RTT response for the day.
    const mockEmptyFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ services: [] })
    });
    
    const rows = await fetchTodayRows(
      { rttBaseUrl: 'x', rttStationCode: 'BGV' },
      { getAccessToken: async () => 'tok', forceRefresh: async () => 'tok' },
      '2026-08-02',
      mockEmptyFetch
    );
    
    // The missing train should be returned, but marked as cancelled
    const firstDep = rows.find(r => r.direction === 'departing');
    expect(firstDep).toBeDefined();
    expect(firstDep!.status).toBe('cancelled');
  });
});


