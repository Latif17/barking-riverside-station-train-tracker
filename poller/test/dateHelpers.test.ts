// poller/test/dateHelpers.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { todayLondon, yesterdayLondon } from '../src/dateHelpers.js';

describe('yesterdayLondon', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the previous day within a normal month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    expect(todayLondon()).toBe('2026-07-15');
    expect(yesterdayLondon()).toBe('2026-07-14');
  });

  it('rolls back across a month boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));

    expect(todayLondon()).toBe('2026-03-01');
    expect(yesterdayLondon()).toBe('2026-02-28');
  });

  it('rolls back across a year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));

    expect(todayLondon()).toBe('2026-01-01');
    expect(yesterdayLondon()).toBe('2025-12-31');
  });

  it('handles the London midnight rollover just after BST transition (late March)', () => {
    // Europe/London is on BST (UTC+1) by late March; just after local
    // midnight on 2026-03-30, todayLondon() should already read the new
    // date and yesterdayLondon() the prior one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T23:30:00Z')); // 00:30 BST on 03-30

    expect(todayLondon()).toBe('2026-03-30');
    expect(yesterdayLondon()).toBe('2026-03-29');
  });
});
