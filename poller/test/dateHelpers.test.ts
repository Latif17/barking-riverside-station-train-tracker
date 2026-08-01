// poller/test/dateHelpers.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayLondon, yesterdayLondon, londonTimeToUtcIso } from '../src/dateHelpers.js';

describe('todayLondon', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current London calendar date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(todayLondon()).toBe('2026-07-15');
  });

  it('reflects the date just after the BST midnight rollover', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T23:30:00Z')); // 00:30 BST on 03-30
    expect(todayLondon()).toBe('2026-03-30');
  });
});

describe('yesterdayLondon', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the previous day within a normal month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(yesterdayLondon()).toBe('2026-07-14');
  });

  it('rolls back across a month boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    expect(yesterdayLondon()).toBe('2026-02-28');
  });

  it('rolls back across a year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    expect(yesterdayLondon()).toBe('2025-12-31');
  });

  it('handles the London midnight rollover just after BST transition (late March)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T23:30:00Z'));
    expect(yesterdayLondon()).toBe('2026-03-29');
  });
});

describe('londonTimeToUtcIso', () => {
  it('converts London local HH:MM to correct UTC instant across BST', () => {
    // 2026-07-29 is BST (UTC+1): 07:00 London = 06:00 UTC
    expect(londonTimeToUtcIso('2026-07-29', '07:00')).toBe('2026-07-29T06:00:00.000Z');
  });

  it('converts London local HH:MM to correct UTC instant in GMT (winter)', () => {
    // 2026-01-05 is GMT (UTC+0): 07:03 London = 07:03 UTC
    expect(londonTimeToUtcIso('2026-01-05', '07:03')).toBe('2026-01-05T07:03:00.000Z');
  });

  it('handles late evening times in BST without day-wrap corruption', () => {
    // 2026-07-29 is BST (UTC+1): 23:15 London = 22:15 UTC, same calendar day
    expect(londonTimeToUtcIso('2026-07-29', '23:15')).toBe('2026-07-29T22:15:00.000Z');
  });

  it('handles the 12:00 boundary time used for RTT window splits', () => {
    expect(londonTimeToUtcIso('2026-07-29', '12:00')).toBe('2026-07-29T11:00:00.000Z');
  });
});
