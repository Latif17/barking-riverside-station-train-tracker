import { describe, it, expect } from 'vitest';
import { applyForceResolveFallback, dedupeRowsByNaturalKey, dedupeByScheduledTime } from '../src/forceResolve.js';
import type { ScheduledServiceRow } from '../src/types.js';

function row(overrides: Partial<ScheduledServiceRow>): ScheduledServiceRow {
  return {
    id: 'row-1',
    service_date: '2026-07-31',
    direction: 'departing',
    scheduled_time: '2026-07-31T07:00:00.000Z',
    peak_period: 'am_peak',
    status: 'pending',
    rtt_uid: 'default-uid',
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

  it('matches rows by direction and rtt_uid, not id', () => {
    const pendingRows = [
      row({ id: 'a', direction: 'arriving', rtt_uid: 'uid-1' }),
    ];
    const freshRows = [
      row({
        id: undefined,
        direction: 'arriving',
        rtt_uid: 'uid-1',
        status: 'on_time',
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
    const first = row({ id: 'a', direction: 'arriving', rtt_uid: 'uid-1' });
    const second = row({ id: 'b', direction: 'departing', rtt_uid: 'uid-2' });

    const result = dedupeRowsByNaturalKey([first, second]);

    expect(result).toEqual([first, second]);
  });

  it('returns an empty array for an empty input', () => {
    expect(dedupeRowsByNaturalKey([])).toEqual([]);
  });
});

describe('dedupeByScheduledTime', () => {
  it('keeps a single row for a scheduled time', () => {
    const r = row({ rtt_uid: 'a' });
    expect(dedupeByScheduledTime([r])).toEqual({ keep: [r], drop: [] });
  });

  it('keeps the non-cancelled row when a replacement shares the scheduled time', () => {
    const cancelled = row({ rtt_uid: 'old', status: 'cancelled' });
    const replacement = row({ rtt_uid: 'new', status: 'on_time' });

    const result = dedupeByScheduledTime([cancelled, replacement]);
    expect(result.keep).toEqual([replacement]);
    expect(result.drop).toEqual([cancelled]);
  });

  it('keeps the last row if all are cancelled', () => {
    const cancelled1 = row({ rtt_uid: 'old1', status: 'cancelled' });
    const cancelled2 = row({ rtt_uid: 'old2', status: 'cancelled' });

    const result = dedupeByScheduledTime([cancelled1, cancelled2]);
    expect(result.keep).toEqual([cancelled2]);
    expect(result.drop).toEqual([cancelled1]);
  });
});
