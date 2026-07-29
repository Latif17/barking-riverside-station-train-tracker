import { describe, it, expect } from 'vitest';
import { computePeakPeriod } from '../src/peakPeriod.js';

describe('computePeakPeriod', () => {
  it('is am_peak at 07:00 London time on a winter weekday', () => {
    // 2026-01-05 is a Monday; GMT = UTC+0, so 07:00 London = 07:00 UTC
    expect(computePeakPeriod(new Date('2026-01-05T07:00:00Z'))).toBe('am_peak');
  });

  it('is off_peak at 07:00 London time on a winter Saturday', () => {
    // 2026-01-03 is a Saturday
    expect(computePeakPeriod(new Date('2026-01-03T07:00:00Z'))).toBe('off_peak');
  });

  it('is pm_peak at 18:30 London time on a summer weekday (BST)', () => {
    // 2026-07-29 is a Wednesday; BST = UTC+1, so 18:30 London = 17:30 UTC
    expect(computePeakPeriod(new Date('2026-07-29T17:30:00Z'))).toBe('pm_peak');
  });

  it('is am_peak at 07:00 London time on a summer weekday (BST)', () => {
    // 07:00 London (BST) = 06:00 UTC
    expect(computePeakPeriod(new Date('2026-07-29T06:00:00Z'))).toBe('am_peak');
  });

  it('is off_peak at midday on a weekday', () => {
    expect(computePeakPeriod(new Date('2026-07-29T11:00:00Z'))).toBe('off_peak');
  });

  it('is off_peak exactly at the am_peak boundary end (09:30)', () => {
    // 09:30 London (BST) = 08:30 UTC — end boundary is exclusive
    expect(computePeakPeriod(new Date('2026-07-29T08:30:00Z'))).toBe('off_peak');
  });

  it('is am_peak exactly at the am_peak boundary start (06:30)', () => {
    // 06:30 London (BST) = 05:30 UTC — start boundary is inclusive
    expect(computePeakPeriod(new Date('2026-07-29T05:30:00Z'))).toBe('am_peak');
  });
});
