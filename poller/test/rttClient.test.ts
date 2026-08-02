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
    const timeFrom = londonTimeToUtcIso('2026-07-31', '00:00');
    const timeTo = londonTimeToUtcIso('2026-07-31', '23:59');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(`timeFrom=${timeFrom}`) && url.includes(`timeTo=${timeTo}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            services: [cancelledArrival, delayedDeparture, onTimeArrival, pendingDeparture],
          }),
        };
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const rowsMap = await fetchTodayRows(
      'https://data.rtt.io',
      makeTokenProvider(),
      '2026-07-31',
      { code: 'BGV' },
      mockFetch as unknown as typeof fetch,
    );

    expect(rowsMap).toBeInstanceOf(Map);
    expect(rowsMap.size).toBe(4);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify one of the mapped services from fixture
    const match = rowsMap.get('2026-07-31T07:04:00.000Z|arriving');
    expect(match).toBeDefined();
    expect(match?.status).toBe('cancelled');
    expect(match?.rtt_uid).toBe('gb-nr:L01500:2026-07-31');
  });

  it('appends filterTo query parameter when provided in options', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ services: [] }),
    });

    await fetchTodayRows(
      'https://data.rtt.io',
      makeTokenProvider(),
      '2026-07-31',
      { code: 'BKG', filterTo: 'BGV' },
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('code=BKG&timeFrom='),
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('&filterTo=BGV'),
      expect.anything(),
    );
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

    const rowsMap = await fetchTodayRows(
      'https://data.rtt.io',
      tokenProvider,
      '2026-07-31',
      { code: 'BGV' },
      mockFetch as unknown as typeof fetch,
    );

    expect(rowsMap.size).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('treats a 204 response as no services', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

    const rowsMap = await fetchTodayRows(
      'https://data.rtt.io',
      makeTokenProvider(),
      '2026-07-31',
      { code: 'BGV' },
      mockFetch as unknown as typeof fetch,
    );

    expect(rowsMap.size).toBe(0);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(
      fetchTodayRows(
        'https://data.rtt.io',
        makeTokenProvider(),
        '2026-07-31',
        { code: 'BGV' },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/503/);
  });
});


