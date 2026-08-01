import { describe, it, expect } from 'vitest';
import { applyForceResolveFallback } from '../src/forceResolve.js';
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
});
