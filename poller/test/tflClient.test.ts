import { describe, it, expect, vi } from 'vitest';
import { fetchArrivals } from '../src/tflClient.js';
import fixture from './fixtures/arrivals.json' with { type: 'json' };

describe('fetchArrivals', () => {
  it('fetches the correct URL and maps the response to TflPrediction[]', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const predictions = await fetchArrivals('910GBARKRIV', mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.tfl.gov.uk/StopPoint/910GBARKRIV/Arrivals',
    );
    expect(predictions).toEqual([
      {
        vehicleId: '202607296734316',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 60,
        expectedArrival: '2026-07-29T16:21:16Z',
      },
      {
        vehicleId: '202607297107111',
        destinationNaptanId: '910GBARKRIV',
        timeToStation: 1393,
        expectedArrival: '2026-07-29T16:44:29Z',
      },
    ]);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(
      fetchArrivals('910GBARKRIV', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(/503/);
  });
});
