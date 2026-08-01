// poller/test/rttClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mapRttServiceToRow, fetchTodayRows } from '../src/rttClient.js';
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

describe('mapRttServiceToRow', () => {
  it('maps a cancelled arrival', () => {
    const row = mapRttServiceToRow(cancelledArrival);
    expect(row).toEqual({
      service_date: '2026-07-31',
      direction: 'arriving',
      scheduled_time: '2026-07-31T07:04:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T07:04:00.000Z')),
      status: 'cancelled',
      rtt_uid: 'gb-nr:L01500:2026-07-31',
    });
  });

  it('maps a delayed departure using realtimeAdvertisedLateness directly', () => {
    const row = mapRttServiceToRow(delayedDeparture);
    expect(row).toEqual({
      service_date: '2026-07-31',
      direction: 'departing',
      scheduled_time: '2026-07-31T07:18:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T07:18:00.000Z')),
      status: 'delayed',
      observed_time: '2026-07-31T07:23:12.000Z',
      delay_minutes: 5,
      rtt_uid: 'gb-nr:L01525:2026-07-31',
    });
  });

  it('maps an on-time arrival (lateness at or below the 3-minute threshold)', () => {
    const row = mapRttServiceToRow(onTimeArrival);
    expect(row?.status).toBe('on_time');
    expect(row?.delay_minutes).toBe(1);
  });

  it('maps a not-yet-run service as pending', () => {
    const row = mapRttServiceToRow(pendingDeparture);
    expect(row).toEqual({
      service_date: '2026-07-31',
      direction: 'departing',
      scheduled_time: '2026-07-31T09:03:00.000Z',
      peak_period: computePeakPeriod(new Date('2026-07-31T09:03:00.000Z')),
      status: 'pending',
      rtt_uid: 'gb-nr:L01545:2026-07-31',
    });
  });

  it('returns null for a service with neither arrival nor departure scheduled', () => {
    expect(mapRttServiceToRow({ temporalData: {} })).toBeNull();
  });
});

describe('fetchTodayRows', () => {
  it('queries the morning and evening windows and maps every returned service', async () => {
    const morningFrom = londonTimeToUtcIso('2026-07-31', '00:00');
    const eveningFrom = londonTimeToUtcIso('2026-07-31', '12:00');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(`timeFrom=${morningFrom}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ services: [cancelledArrival, delayedDeparture] }),
        };
      }
      if (url.includes(`timeFrom=${eveningFrom}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ services: [onTimeArrival, pendingDeparture] }),
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

    expect(rows).toHaveLength(4);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('code=BGV');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer access-abc' } });
  });

  it('retries once after a 401 by forcing a token refresh', async () => {
    // fetchTodayRows fires both time windows concurrently (Promise.all), so
    // both windows' initial getAccessToken() calls race on a cold cache —
    // each may independently request its own token. Use an unbounded
    // incrementing-token mock (not a fixed two-response queue) so the race
    // can't starve either window of a token, and assert on a *behavioral*
    // property (the retry's Authorization header differs from that same
    // URL's first, rejected attempt) rather than a specific token string,
    // since which token each concurrent window receives first is
    // non-deterministic.
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
      // The retry must use a token forced fresh via forceRefresh(), not the
      // token that was just rejected for this same URL.
      expect(auth).not.toBe(firstAttemptAuth.get(url));
      return { ok: true, status: 200, json: async () => ({ services: [] }) };
    });

    const rows = await fetchTodayRows(
      { rttBaseUrl: 'https://data.rtt.io', rttStationCode: 'BGV' },
      tokenProvider,
      '2026-07-31',
      mockFetch as unknown as typeof fetch,
    );

    expect(rows).toEqual([]);
    // 2 windows, each first tried (401) then retried once — 4 calls total.
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

    expect(rows).toEqual([]);
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
