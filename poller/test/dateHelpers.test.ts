// poller/test/dateHelpers.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayLondon, londonTimeToUtcIso } from '../src/dateHelpers.js';

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

  it('handles times before the DST spring forward transition correctly', () => {
    // 2024-03-31 is spring forward (BST starts at 01:00 GMT -> 02:00 BST).
    // 00:11 local time is still GMT.
    expect(londonTimeToUtcIso('2024-03-31', '00:11')).toBe('2024-03-31T00:11:00.000Z');
  });

  it('handles times before the DST fall back transition correctly', () => {
    // 2024-10-27 is fall back (GMT starts at 02:00 BST -> 01:00 GMT).
    // 00:11 local time is still BST.
    expect(londonTimeToUtcIso('2024-10-27', '00:11')).toBe('2024-10-26T23:11:00.000Z');
  });
});
