import { describe, it, expect } from 'vitest';
import {
  aggregateStatusCounts,
  toPercentages,
  aggregateByPeakPeriod,
  aggregateTrendByDate,
} from '../lib/aggregate';

describe('aggregateStatusCounts', () => {
  it('counts each status and total', () => {
    const rows = [
      { status: 'on_time' }, { status: 'early' }, { status: 'on_time' }, { status: 'delayed' },
      { status: 'cancelled' }, { status: 'pending' },
    ];
    expect(aggregateStatusCounts(rows)).toEqual({
      early: 1, onTime: 2, delayed: 1, cancelled: 1, pending: 1, total: 6,
    });
  });

  it('returns all zeros for an empty array', () => {
    expect(aggregateStatusCounts([])).toEqual({
      early: 0, onTime: 0, delayed: 0, cancelled: 0, pending: 0, total: 0,
    });
  });
});

describe('toPercentages', () => {
  it('computes percentages of RESOLVED services only, excluding pending', () => {
    const counts = { early: 1, onTime: 5, delayed: 3, cancelled: 1, pending: 10, total: 20 };
    const pct = toPercentages(counts);
    expect(pct.total).toBe(10); // 1+5+3+1, pending excluded
    expect(pct.earlyPercent).toBeCloseTo(10);
    expect(pct.onTimePercent).toBeCloseTo(50);
    expect(pct.delayedPercent).toBeCloseTo(30);
    expect(pct.cancelledPercent).toBeCloseTo(10);
  });

  it('returns all zeros when there are no resolved services', () => {
    const counts = { early: 0, onTime: 0, delayed: 0, cancelled: 0, pending: 5, total: 5 };
    expect(toPercentages(counts)).toEqual({
      earlyPercent: 0, onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0,
    });
  });
});

describe('aggregateByPeakPeriod', () => {
  it('splits rows into am_peak/pm_peak/off_peak buckets', () => {
    const rows = [
      { peak_period: 'am_peak', status: 'on_time' },
      { peak_period: 'am_peak', status: 'early' },
      { peak_period: 'am_peak', status: 'cancelled' },
      { peak_period: 'pm_peak', status: 'delayed' },
      { peak_period: 'off_peak', status: 'on_time' },
      { peak_period: 'off_peak', status: 'on_time' },
    ];
    const result = aggregateByPeakPeriod(rows);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.peakPeriod)).toEqual(['am_peak', 'pm_peak', 'off_peak']);

    const am = result.find((r) => r.peakPeriod === 'am_peak')!;
    expect(am.counts).toEqual({ early: 1, onTime: 1, delayed: 0, cancelled: 1, pending: 0, total: 3 });
    expect(am.percentages.earlyPercent).toBeCloseTo(33.333);
    expect(am.percentages.onTimePercent).toBeCloseTo(33.333);
    expect(am.percentages.cancelledPercent).toBeCloseTo(33.333);

    const off = result.find((r) => r.peakPeriod === 'off_peak')!;
    expect(off.counts.total).toBe(2);
    expect(off.percentages.onTimePercent).toBeCloseTo(100);
  });

  it('returns a zeroed row for a peak period with no data', () => {
    const result = aggregateByPeakPeriod([{ peak_period: 'am_peak', status: 'on_time' }]);
    const pm = result.find((r) => r.peakPeriod === 'pm_peak')!;
    expect(pm.counts.total).toBe(0);
    expect(pm.percentages.total).toBe(0);
  });
});

describe('aggregateTrendByDate', () => {
  it('groups by service_date, sorted ascending, with cancellation rate per day', () => {
    const rows = [
      { service_date: '2026-07-02', status: 'on_time' },
      { service_date: '2026-07-01', status: 'cancelled' },
      { service_date: '2026-07-01', status: 'early' },
      { service_date: '2026-07-01', status: 'on_time' },
      { service_date: '2026-07-02', status: 'cancelled' },
    ];
    const trend = aggregateTrendByDate(rows);
    expect(trend.map((t) => t.date)).toEqual(['2026-07-01', '2026-07-02']);

    expect(trend[0].total).toBe(3);
    expect(trend[0].cancellationRatePercent).toBeCloseTo(100 / 3);

    expect(trend[1].total).toBe(2);
    expect(trend[1].cancellationRatePercent).toBeCloseTo(50);
  });

  it('excludes pending rows from the per-day rate but keeps the date if any resolved row exists', () => {
    const rows = [
      { service_date: '2026-07-01', status: 'on_time' },
      { service_date: '2026-07-01', status: 'pending' },
    ];
    const trend = aggregateTrendByDate(rows);
    expect(trend[0].total).toBe(1);
    expect(trend[0].cancellationRatePercent).toBe(0);
  });

  it('returns an empty array for no rows', () => {
    expect(aggregateTrendByDate([])).toEqual([]);
  });
});
