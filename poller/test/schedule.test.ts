import { describe, it, expect } from 'vitest';
import { getScheduledServicesForDate } from '../src/schedule.js';

describe('schedule', () => {
  it('generates expected services for a Wednesday (weekday)', () => {
    // 2026-08-05 is a Wednesday
    const rows = getScheduledServicesForDate('2026-08-05');
    expect(rows.length).toBeGreaterThan(0);
    const firstDeparture = rows.find(r => r.direction === 'departing');
    expect(firstDeparture?.status).toBe('pending');
    expect(firstDeparture?.scheduled_time).toBe('2026-08-05T04:33:00.000Z'); // 05:33 BST -> 04:33 UTC
    expect(firstDeparture?.delay_minutes).toBe(0);
  });

  it('generates expected services for a Sunday', () => {
    // 2026-08-02 is a Sunday
    const rows = getScheduledServicesForDate('2026-08-02');
    expect(rows.some(r => r.direction === 'departing')).toBe(true);
  });

  it('generates expected services for a Saturday', () => {
    // 2026-08-08 is a Saturday
    const rows = getScheduledServicesForDate('2026-08-08');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(r => r.direction === 'departing')).toBe(true);
    expect(rows.some(r => r.direction === 'arriving')).toBe(true);
  });
});
