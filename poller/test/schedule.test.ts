import { describe, it, expect } from 'vitest';
import { buildSeedRows } from '../src/schedule.js';
import type { ScheduleConfig } from '../src/types.js';

const testSchedule: ScheduleConfig = {
  effective_from: '2026-01-01',
  weekday: { departing: ['07:03', '18:15'], arriving: ['07:20'] },
  saturday: { departing: ['09:00'], arriving: [] },
  sunday: { departing: [], arriving: [] },
};

describe('buildSeedRows', () => {
  it('builds one row per scheduled time for a weekday, with correct peak_period', () => {
    // 2026-01-05 is a Monday (winter/GMT)
    const rows = buildSeedRows(testSchedule, '2026-01-05');

    expect(rows).toHaveLength(3);

    const departure1 = rows.find(
      (r) => r.direction === 'departing' && r.scheduled_time === '2026-01-05T07:03:00.000Z',
    );
    expect(departure1?.peak_period).toBe('am_peak');
    expect(departure1?.status).toBe('pending');
    expect(departure1?.service_date).toBe('2026-01-05');

    const departure2 = rows.find(
      (r) => r.direction === 'departing' && r.scheduled_time === '2026-01-05T18:15:00.000Z',
    );
    expect(departure2?.peak_period).toBe('pm_peak');

    const arrival1 = rows.find((r) => r.direction === 'arriving');
    expect(arrival1?.scheduled_time).toBe('2026-01-05T07:20:00.000Z');
    expect(arrival1?.peak_period).toBe('am_peak');
  });

  it('uses the saturday schedule for a Saturday date', () => {
    // 2026-01-03 is a Saturday
    const rows = buildSeedRows(testSchedule, '2026-01-03');
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_time).toBe('2026-01-03T09:00:00.000Z');
    expect(rows[0].peak_period).toBe('off_peak');
  });

  it('uses the sunday schedule (empty) for a Sunday date', () => {
    // 2026-01-04 is a Sunday
    const rows = buildSeedRows(testSchedule, '2026-01-04');
    expect(rows).toHaveLength(0);
  });

  it('converts London local HH:MM to correct UTC instant across BST', () => {
    const bstSchedule: ScheduleConfig = {
      effective_from: '2026-01-01',
      weekday: { departing: ['07:00'], arriving: [] },
      saturday: { departing: [], arriving: [] },
      sunday: { departing: [], arriving: [] },
    };
    // 2026-07-29 is a Wednesday, BST (UTC+1): 07:00 London = 06:00 UTC
    const rows = buildSeedRows(bstSchedule, '2026-07-29');
    expect(rows[0].scheduled_time).toBe('2026-07-29T06:00:00.000Z');
  });

  it('handles late evening times in BST without day-wrap corruption', () => {
    const bstSchedule: ScheduleConfig = {
      effective_from: '2026-01-01',
      weekday: { departing: ['23:15'], arriving: [] },
      saturday: { departing: [], arriving: [] },
      sunday: { departing: [], arriving: [] },
    };
    // 2026-07-29 is a Wednesday, BST (UTC+1): 23:15 London = 22:15 UTC, same calendar day
    const rows = buildSeedRows(bstSchedule, '2026-07-29');
    expect(rows[0].scheduled_time).toBe('2026-07-29T22:15:00.000Z');
    expect(rows[0].service_date).toBe('2026-07-29');
  });
});
