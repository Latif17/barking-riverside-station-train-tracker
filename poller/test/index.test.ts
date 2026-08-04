// poller/test/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollOnce, getPollInterval } from '../src/index.js';
import * as rttClient from '../src/rttClient.js';
import * as repository from '../src/repository.js';
import type { ScheduledServiceRow } from '../src/types.js';

describe('pollOnce during sleep period', () => {
  let fetchTodayRowsSpy: any;
  let fetchAllRowsForDateSpy: any;
  let upsertScheduledServicesSpy: any;

  const dummyConfig = {
    supabaseUrl: 'http://localhost',
    supabaseServiceRoleKey: 'key',
    rttBaseUrl: 'http://localhost/bgv',
    rttBaseUrl2: 'http://localhost/bkg',
    rttRefreshToken: 'token1',
    rttRefreshToken2: 'token2',
    rttStationCode: 'gb-nr:BGV',
    rttStationCode2: 'gb-nr:BKG',
    pollIntervalPeakMs: 40000,
    pollIntervalOffPeakMs: 120000,
    pollIntervalSleepMs: 60000,
  };

  beforeEach(() => {
    fetchTodayRowsSpy = vi.spyOn(rttClient, 'fetchTodayRows').mockResolvedValue([]);
    fetchAllRowsForDateSpy = vi.spyOn(repository, 'fetchAllRowsForDate').mockResolvedValue([]);
    upsertScheduledServicesSpy = vi.spyOn(repository, 'upsertScheduledServices').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('skips polling entirely when current London time is during sleep period', async () => {
    // 02:00 London time (GMT) is sleep period
    vi.setSystemTime(new Date('2026-01-05T02:00:00Z'));

    await pollOnce(dummyConfig as any, {} as any, {} as any, {} as any);

    expect(fetchTodayRowsSpy).not.toHaveBeenCalled();
    expect(fetchAllRowsForDateSpy).not.toHaveBeenCalled();
  });

  it('proceeds with polling when current London time is NOT sleep period', async () => {
    // 08:00 London time (GMT) is am_peak period
    vi.setSystemTime(new Date('2026-01-05T08:00:00Z'));

    await pollOnce(dummyConfig as any, {} as any, {} as any, {} as any);

    expect(fetchTodayRowsSpy).toHaveBeenCalledTimes(2);
    expect(fetchAllRowsForDateSpy).toHaveBeenCalled();
  });

  it('fetches both BGV and BKG streams concurrently and merges with schedule', async () => {
    // Monday 08:00 London time (winter: 2026-01-05 is GMT)
    vi.setSystemTime(new Date('2026-01-05T08:00:00Z'));

    const serviceTime = '2026-01-05T08:19:00.000Z';

    const bgvRows: ScheduledServiceRow[] = [
      {
        service_date: '2026-01-05',
        direction: 'arriving',
        scheduled_time: serviceTime,
        peak_period: 'am_peak',
        status: 'on_time',
        observed_time: serviceTime,
        delay_minutes: 0,
        rtt_uid: 'W12345',
      },
    ];

    const bkgRows: ScheduledServiceRow[] = [
      {
        service_date: '2026-01-05',
        direction: 'departing',
        scheduled_time: '2026-01-05T08:13:00.000Z', // Different scheduled time for BKG
        peak_period: 'am_peak',
        status: 'delayed',
        observed_time: '2026-01-05T08:22:00.000Z',
        delay_minutes: 3,
        rtt_uid: 'W12345',
      },
    ];

    fetchTodayRowsSpy.mockImplementation(async (baseUrl: string, tokenProvider: any, date: string, options: any) => {
      if (options.code === 'gb-nr:BGV') return bgvRows;
      if (options.code === 'gb-nr:BKG') return bkgRows;
      return [];
    });

    await pollOnce(dummyConfig as any, {} as any, {} as any, {} as any);

    expect(fetchTodayRowsSpy).toHaveBeenCalledWith('http://localhost/bgv', expect.anything(), '2026-01-05', {
      code: 'gb-nr:BGV',
    });
    expect(fetchTodayRowsSpy).toHaveBeenCalledWith('http://localhost/bkg', expect.anything(), '2026-01-05', {
      code: 'gb-nr:BKG',
      filterTo: 'gb-nr:BGV',
    });

    expect(upsertScheduledServicesSpy).toHaveBeenCalled();
    const upsertedRows: ScheduledServiceRow[] = upsertScheduledServicesSpy.mock.calls[0][1];
    const targetRow = upsertedRows.find((r) => r.scheduled_time === serviceTime && r.direction === 'arriving');

    expect(targetRow).toBeDefined();
    expect(targetRow?.status).toBe('delayed');
    expect(targetRow?.rtt_uid).toBe('W12345');
    expect(targetRow?.upstream_status).toBe('delayed');
    expect(targetRow?.upstream_delay_minutes).toBe(3);
    expect(targetRow?.delay_minutes).toBe(3);
  });

  it('correctly maps early trains with negative delay and early status in pollOnce', async () => {
    vi.setSystemTime(new Date('2026-01-05T08:00:00Z'));

    const serviceTime = '2026-01-05T08:19:00.000Z';

    const bgvRows: ScheduledServiceRow[] = [
      {
        service_date: '2026-01-05',
        direction: 'arriving',
        scheduled_time: serviceTime,
        peak_period: 'am_peak',
        status: 'early',
        observed_time: '2026-01-05T08:17:00.000Z',
        delay_minutes: -2,
        rtt_uid: 'W12345',
      },
    ];

    fetchTodayRowsSpy.mockImplementation(async (baseUrl: string, tokenProvider: any, date: string, options: any) => {
      if (options.code === 'gb-nr:BGV') return bgvRows;
      return [];
    });

    await pollOnce(dummyConfig as any, {} as any, {} as any, {} as any);

    expect(upsertScheduledServicesSpy).toHaveBeenCalled();
    const upsertedRows: ScheduledServiceRow[] = upsertScheduledServicesSpy.mock.calls[0][1];
    const targetRow = upsertedRows.find((r) => r.scheduled_time === serviceTime && r.direction === 'arriving');

    expect(targetRow).toBeDefined();
    expect(targetRow?.status).toBe('early');
    expect(targetRow?.delay_minutes).toBe(-2);
    expect(targetRow?.observed_time).toBe('2026-01-05T08:17:00.000Z');
  });

  it('marks missing BGV or BKG services as cancelled and cancels ghost pending services older than 30 minutes', async () => {
    // 08:35 London time on 2026-01-05
    vi.setSystemTime(new Date('2026-01-05T08:35:00Z'));

    const bgvOldPendingTime = '2026-01-05T08:03:00.000Z'; // 32 mins ago (>= 30 mins)
    const bgvRecentPendingTime = '2026-01-05T08:19:00.000Z'; // 16 mins ago (< 30 mins)

    const bgvRows: ScheduledServiceRow[] = [
      {
        service_date: '2026-01-05',
        direction: 'departing',
        scheduled_time: bgvOldPendingTime,
        peak_period: 'am_peak',
        status: 'pending',
        observed_time: null,
        delay_minutes: 0,
        rtt_uid: 'W11111',
      },
      {
        service_date: '2026-01-05',
        direction: 'departing',
        scheduled_time: bgvRecentPendingTime,
        peak_period: 'am_peak',
        status: 'pending',
        observed_time: null,
        delay_minutes: 0,
        rtt_uid: 'W22222',
      },
    ];

    // bkgRows empty => all bkg status will be cancelled
    fetchTodayRowsSpy.mockImplementation(async (baseUrl: string, tokenProvider: any, date: string, options: any) => {
      if (options.code === 'gb-nr:BGV') return bgvRows;
      return [];
    });

    await pollOnce(dummyConfig as any, {} as any, {} as any, {} as any);

    expect(upsertScheduledServicesSpy).toHaveBeenCalled();
    const upsertedRows: ScheduledServiceRow[] = upsertScheduledServicesSpy.mock.calls[0][1];

    const oldRow = upsertedRows.find((r) => r.scheduled_time === bgvOldPendingTime && r.direction === 'departing');
    expect(oldRow).toBeDefined();
    expect(oldRow?.status).toBe('cancelled'); // Cancelled due to ghost threshold >= 30m
    expect(oldRow?.upstream_status).toBeUndefined(); // Missing from BKG

    const recentRow = upsertedRows.find((r) => r.scheduled_time === bgvRecentPendingTime && r.direction === 'departing');
    expect(recentRow).toBeDefined();
    expect(recentRow?.status).toBe('pending'); // Still pending since < 30m
    expect(recentRow?.upstream_status).toBeUndefined(); // Missing from BKG
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

