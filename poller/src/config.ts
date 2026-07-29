// poller/src/config.ts

export interface Config {
  tflStopPointId: string;
  tflLineId: string;
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
    tflStopPointId: '910GBARKRIV',
    tflLineId: 'suffragette',
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalMs: process.env.POLL_INTERVAL_MS
      ? Number(process.env.POLL_INTERVAL_MS)
      : 45000,
  };
}
