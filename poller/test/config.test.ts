// poller/test/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.RTT_REFRESH_TOKEN = 'test-refresh-token';
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.POLL_INTERVAL_PEAK_MS;
    delete process.env.POLL_INTERVAL_OFF_PEAK_MS;
    delete process.env.POLL_INTERVAL_SLEEP_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads required values from env and applies defaults', () => {
    const config = loadConfig();
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.supabaseServiceRoleKey).toBe('test-key');
    expect(config.rttRefreshToken).toBe('test-refresh-token');
    expect(config.rttBaseUrl).toBe('https://data.rtt.io');
    expect(config.rttStationCode).toBe('gb-nr:BGV');
    expect(config.pollIntervalPeakMs).toBe(40000);
    expect(config.pollIntervalOffPeakMs).toBe(120000);
    expect(config.pollIntervalSleepMs).toBe(60000);
  });

  it('respects interval overrides', () => {
    process.env.POLL_INTERVAL_PEAK_MS = '30000';
    process.env.POLL_INTERVAL_OFF_PEAK_MS = '90000';
    process.env.POLL_INTERVAL_SLEEP_MS = '45000';
    const config = loadConfig();
    expect(config.pollIntervalPeakMs).toBe(30000);
    expect(config.pollIntervalOffPeakMs).toBe(90000);
    expect(config.pollIntervalSleepMs).toBe(45000);
  });

  it('throws if SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL;
    expect(() => loadConfig()).toThrow(/SUPABASE_URL/);
  });

  it('throws if SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => loadConfig()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('throws if RTT_REFRESH_TOKEN is missing', () => {
    delete process.env.RTT_REFRESH_TOKEN;
    expect(() => loadConfig()).toThrow(/RTT_REFRESH_TOKEN/);
  });
});
