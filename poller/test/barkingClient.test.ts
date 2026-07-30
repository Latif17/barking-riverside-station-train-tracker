import { describe, it, expect, vi } from 'vitest';
import { fetchBarkingOutboundArrivals } from '../src/barkingClient.js';
import fixture from './fixtures/barkingArrivals.json' with { type: 'json' };

describe('fetchBarkingOutboundArrivals', () => {
  it('fetches the correct URL and returns only Gospel-Oak-bound predictions on the given line', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const predictions = await fetchBarkingOutboundArrivals(
      '910GBARKING',
      'suffragette',
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).toHaveBeenCalledWith('https://api.tfl.gov.uk/StopPoint/910GBARKING/Arrivals');
    expect(predictions).toEqual([
      {
        vehicleId: '202607307106962',
        destinationNaptanId: '910GGOSPLOK',
        timeToStation: 245,
        expectedArrival: '2026-07-30T09:09:00Z',
      },
    ]);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(
      fetchBarkingOutboundArrivals('910GBARKING', 'suffragette', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(/503/);
  });
});
