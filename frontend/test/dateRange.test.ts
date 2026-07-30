import { describe, it, expect } from 'vitest';
import { computeDateRange } from '../lib/dateRange';

describe('computeDateRange', () => {
  it('returns a single-day range for days=1', () => {
    const range = computeDateRange(1, new Date('2026-07-29T12:00:00Z'));
    expect(range).toEqual({ from: '2026-07-29', to: '2026-07-29' });
  });

  it('returns a 7-day range ending today (inclusive)', () => {
    const range = computeDateRange(7, new Date('2026-07-29T12:00:00Z'));
    expect(range).toEqual({ from: '2026-07-23', to: '2026-07-29' });
  });

  it('uses London local date, not raw UTC date, near midnight BST', () => {
    // 2026-07-29T23:30:00Z is 2026-07-30T00:30 in London (BST, UTC+1) -
    // the range's "to" date must be the London date, 2026-07-30.
    const range = computeDateRange(1, new Date('2026-07-29T23:30:00Z'));
    expect(range.to).toBe('2026-07-30');
  });

  it('uses London local date in winter (GMT, UTC+0)', () => {
    const range = computeDateRange(1, new Date('2026-01-05T12:00:00Z'));
    expect(range).toEqual({ from: '2026-01-05', to: '2026-01-05' });
  });

  it('handles a 30-day range spanning a month boundary', () => {
    const range = computeDateRange(30, new Date('2026-01-05T12:00:00Z'));
    expect(range).toEqual({ from: '2025-12-07', to: '2026-01-05' });
  });
});
