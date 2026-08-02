// poller/src/config.ts

export interface Config {
  rttBaseUrl: string;
  rttBaseUrl2: string;
  rttStationCode: string;
  rttStationCode2: string;
  rttRefreshToken: string;
  rttRefreshToken2: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  pollIntervalPeakMs: number;
  pollIntervalOffPeakMs: number;
  pollIntervalSleepMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    rttBaseUrl: 'https://data.rtt.io',
    rttBaseUrl2: process.env.RTT_BASE_URL_2 || 'https://data.rtt.io',
    // The generic /rtt/location endpoint requires a namespaced code (per
    // its own OpenAPI example, "gb-nr:CLPHMJN") — a bare CRS code like
    // "BGV" is rejected with {"error":"unable to interpret code: BGV"}.
    rttStationCode: 'gb-nr:BGV',
    rttStationCode2: 'gb-nr:BKG',
    rttRefreshToken: requireEnv('RTT_REFRESH_TOKEN'),
    rttRefreshToken2: requireEnv('RTT_REFRESH_TOKEN_2'),
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalPeakMs: process.env.POLL_INTERVAL_PEAK_MS
      ? Number(process.env.POLL_INTERVAL_PEAK_MS)
      : 40000,
    pollIntervalOffPeakMs: process.env.POLL_INTERVAL_OFF_PEAK_MS
      ? Number(process.env.POLL_INTERVAL_OFF_PEAK_MS)
      : 120000,
    pollIntervalSleepMs: process.env.POLL_INTERVAL_SLEEP_MS
      ? Number(process.env.POLL_INTERVAL_SLEEP_MS)
      : 60000,
  };
}
