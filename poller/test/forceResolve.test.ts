import { describe, it, expect } from 'vitest';
import { applyForceResolveFallback, dedupeRowsByNaturalKey } from '../src/forceResolve.js';
import type { ScheduledServiceRow } from '../src/types.js';

function row(overrides: Partial<ScheduledServiceRow>): ScheduledServiceRow {
  return {
    id: 'row-1',
    service_date: '2026-07-31',
    direction: 'departing',
    scheduled_time: '2026-07-31T07:00:00.000Z',
    peak_period: 'am_peak',
    status: 'pending',
    ...overrides,
  };
}

describe('applyForceResolveFallback', () => {
  it('cancels a pending row missing from the fresh RTT rows once 30 minutes past its scheduled time', () => {
    const pendingRows = [row({ id: 'a' })];
    const now = new Date('2026-07-31T07:31:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, [], now);

    expect(resolved).toEqual([{ ...pendingRows[0], status: 'cancelled' }]);
  });

  it('leaves a pending row alone if it is still within the 30-minute grace period', () => {
    const pendingRows = [row({ id: 'a' })];
    const now = new Date('2026-07-31T07:20:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, [], now);

    expect(resolved).toEqual([]);
  });

  it('does not touch a pending row that RTT still reports, even past 30 minutes', () => {
    const pendingRows = [row({ id: 'a' })];
    const freshRows = [row({ id: undefined, status: 'pending' })];
    const now = new Date('2026-07-31T07:31:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, freshRows, now);

    expect(resolved).toEqual([]);
  });

  it('matches rows by direction and scheduled_time, not id', () => {
    const pendingRows = [
      row({ id: 'a', direction: 'arriving', scheduled_time: '2026-07-31T07:05:00.000Z' }),
    ];
    const freshRows = [
      row({
        id: undefined,
        direction: 'arriving',
        scheduled_time: '2026-07-31T07:05:00.000Z',
        status: 'on_time',
      }),
    ];
    const now = new Date('2026-07-31T07:40:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, freshRows, now);

    expect(resolved).toEqual([]);
  });

  it('matches rows whose scheduled_time strings differ in format but represent the same instant', () => {
    // Supabase/PostgREST serializes timestamptz without milliseconds and with
    // a +00:00 offset; RTT-derived rows use toISOString()'s .000Z format.
    // Both represent 2026-07-31T07:05:00 UTC.
    const pendingRows = [
      row({ id: 'a', direction: 'arriving', scheduled_time: '2026-07-31T07:05:00+00:00' }),
    ];
    const freshRows = [
      row({
        id: undefined,
        direction: 'arriving',
        scheduled_time: '2026-07-31T07:05:00.000Z',
        status: 'pending',
      }),
    ];
    const now = new Date('2026-07-31T07:40:00.000Z');

    const resolved = applyForceResolveFallback(pendingRows, freshRows, now);

    expect(resolved).toEqual([]);
  });
});

describe('dedupeRowsByNaturalKey', () => {
  it('keeps the last row when two rows share the same natural key', () => {
    const first = row({ id: 'a', status: 'pending' });
    const second = row({ id: 'b', status: 'cancelled' });

    const result = dedupeRowsByNaturalKey([first, second]);

    expect(result).toEqual([second]);
  });

  it('keeps all rows when natural keys differ', () => {
    const first = row({ id: 'a', direction: 'arriving', scheduled_time: '2026-07-31T07:00:00.000Z' });
    const second = row({ id: 'b', direction: 'departing', scheduled_time: '2026-07-31T08:00:00.000Z' });

    const result = dedupeRowsByNaturalKey([first, second]);

    expect(result).toEqual([first, second]);
  });

  it('returns an empty array for an empty input', () => {
    expect(dedupeRowsByNaturalKey([])).toEqual([]);
  });
});
