// poller/src/config.ts

export interface Config {
  rttBaseUrl: string;
  rttStationCode: string;
  rttRefreshToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  pollIntervalMs: number;
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
    // The generic /rtt/location endpoint requires a namespaced code (per
    // its own OpenAPI example, "gb-nr:CLPHMJN") — a bare CRS code like
    // "BGV" is rejected with {"error":"unable to interpret code: BGV"}.
    rttStationCode: 'gb-nr:BGV',
    rttRefreshToken: requireEnv('RTT_REFRESH_TOKEN'),
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalMs: process.env.POLL_INTERVAL_MS
      ? Number(process.env.POLL_INTERVAL_MS)
      : 45000,
  };
}
