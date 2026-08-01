import { describe, it, expect, vi } from 'vitest';
import { createTokenProvider } from '../src/rttAuth.js';

describe('createTokenProvider', () => {
  it('fetches an access token using the refresh token as the bearer', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'access-1', validUntil: '2026-07-31T08:00:00Z', entitlements: [] }),
    });

    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    const token = await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));

    expect(token).toBe('access-1');
    expect(mockFetch).toHaveBeenCalledWith('https://data.rtt.io/api/get_access_token', {
      headers: { Authorization: 'Bearer refresh-token-abc' },
    });
  });

  it('reuses the cached token while still valid', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'access-1', validUntil: '2026-07-31T08:00:00Z' }),
    });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));
    const token = await provider.getAccessToken(new Date('2026-07-31T07:30:00Z'));

    expect(token).toBe('access-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes once the cached token is within the 60-second expiry buffer', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-1', validUntil: '2026-07-31T07:01:00Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-2', validUntil: '2026-07-31T08:00:00Z' }),
      });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));
    // 07:00:05 is only 55s before the 07:01:00 expiry — inside the 60s buffer.
    const token = await provider.getAccessToken(new Date('2026-07-31T07:00:05Z'));

    expect(token).toBe('access-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await expect(provider.getAccessToken(new Date('2026-07-31T07:00:00Z'))).rejects.toThrow(/401/);
  });

  it('forceRefresh always requests a new token, bypassing the cache', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-1', validUntil: '2026-07-31T08:00:00Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'access-2', validUntil: '2026-07-31T09:00:00Z' }),
      });
    const provider = createTokenProvider(
      { baseUrl: 'https://data.rtt.io', refreshToken: 'refresh-token-abc' },
      mockFetch as unknown as typeof fetch,
    );

    await provider.getAccessToken(new Date('2026-07-31T07:00:00Z'));
    const token = await provider.forceRefresh();

    expect(token).toBe('access-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
