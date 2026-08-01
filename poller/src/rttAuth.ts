export interface RttAuthConfig {
  baseUrl: string;
  refreshToken: string;
}

export interface TokenProvider {
  getAccessToken(now?: Date): Promise<string>;
}

interface CachedToken {
  token: string;
  validUntilMs: number;
}

interface AccessTokenResponse {
  token: string;
  validUntil: string;
}

const REFRESH_BUFFER_MS = 60 * 1000;

export function createTokenProvider(
  config: RttAuthConfig,
  fetchFn: typeof fetch = fetch,
): TokenProvider {
  let cached: CachedToken | null = null;

  async function requestNewToken(): Promise<string> {
    const response = await fetchFn(`${config.baseUrl}/api/get_access_token`, {
      headers: { Authorization: `Bearer ${config.refreshToken}` },
    });

    if (!response.ok) {
      throw new Error(`RTT get_access_token failed with status ${response.status}`);
    }

    const body = (await response.json()) as AccessTokenResponse;
    cached = { token: body.token, validUntilMs: new Date(body.validUntil).getTime() };
    return cached.token;
  }

  async function getAccessToken(now: Date = new Date()): Promise<string> {
    if (cached && cached.validUntilMs - REFRESH_BUFFER_MS > now.getTime()) {
      return cached.token;
    }
    return requestNewToken();
  }

  return { getAccessToken, forceRefresh: requestNewToken };
}
