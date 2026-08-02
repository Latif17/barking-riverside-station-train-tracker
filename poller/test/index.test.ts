// poller/test/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollOnce, getPollInterval } from '../src/index.js';
import * as rttClient from '../src/rttClient.js';
import * as repository from '../src/repository.js';

describe('pollOnce during sleep period', () => {
  let fetchTodayRowsSpy: any;
  let fetchAllRowsForDateSpy: any;

  beforeEach(() => {
    fetchTodayRowsSpy = vi.spyOn(rttClient, 'fetchTodayRows').mockResolvedValue(new Map());
    fetchAllRowsForDateSpy = vi.spyOn(repository, 'fetchAllRowsForDate').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('skips polling entirely when current London time is during sleep period', async () => {
    // 02:00 London time (GMT) is sleep period
    vi.setSystemTime(new Date('2026-01-05T02:00:00Z'));

    const dummyConfig = {
      supabaseUrl: 'http://localhost',
      supabaseServiceRoleKey: 'key',
      rttBaseUrl: 'http://localhost',
      rttRefreshToken: 'token',
      rttStationCode: 'BGV',
      pollIntervalPeakMs: 40000,
      pollIntervalOffPeakMs: 120000,
      pollIntervalSleepMs: 60000,
    };

    await pollOnce(dummyConfig as any, {} as any, {} as any);

    expect(fetchTodayRowsSpy).not.toHaveBeenCalled();
    expect(fetchAllRowsForDateSpy).not.toHaveBeenCalled();
  });

  it('proceeds with polling when current London time is NOT sleep period', async () => {
    // 08:00 London time (GMT) is am_peak period
    vi.setSystemTime(new Date('2026-01-05T08:00:00Z'));

    const dummyConfig = {
      supabaseUrl: 'http://localhost',
      supabaseServiceRoleKey: 'key',
      rttBaseUrl: 'http://localhost',
      rttRefreshToken: 'token',
      rttStationCode: 'BGV',
      pollIntervalPeakMs: 40000,
      pollIntervalOffPeakMs: 120000,
      pollIntervalSleepMs: 60000,
    };

    await pollOnce(dummyConfig as any, {} as any, {} as any);

    expect(fetchTodayRowsSpy).toHaveBeenCalled();
    expect(fetchAllRowsForDateSpy).toHaveBeenCalled();
  });
});

describe('getPollInterval', () => {
  const dummyConfig = {
    pollIntervalPeakMs: 40000,
    pollIntervalOffPeakMs: 120000,
    pollIntervalSleepMs: 60000,
  } as any;

  it('returns peak interval for am_peak', () => {
    expect(getPollInterval('am_peak', dummyConfig)).toBe(40000);
  });

  it('returns peak interval for pm_peak', () => {
    expect(getPollInterval('pm_peak', dummyConfig)).toBe(40000);
  });

  it('returns off-peak interval for off_peak', () => {
    expect(getPollInterval('off_peak', dummyConfig)).toBe(120000);
  });

  it('returns sleep interval for sleep', () => {
    expect(getPollInterval('sleep', dummyConfig)).toBe(60000);
  });
});
