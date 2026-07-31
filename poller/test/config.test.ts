// poller/test/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    delete process.env.POLL_INTERVAL_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads required values from env and applies defaults', () => {
    const config = loadConfig();
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.supabaseServiceRoleKey).toBe('test-key');
    expect(config.tflStopPointId).toBe('910GBARKRIV');
    expect(config.barkingStopPointId).toBe('910GBARKING');
    expect(config.tflLineId).toBe('suffragette');
    expect(config.pollIntervalMs).toBe(45000);
  });

  it('respects POLL_INTERVAL_MS override', () => {
    process.env.POLL_INTERVAL_MS = '30000';
    expect(loadConfig().pollIntervalMs).toBe(30000);
  });

  it('throws if SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL;
    expect(() => loadConfig()).toThrow(/SUPABASE_URL/);
  });

  it('throws if SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => loadConfig()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
