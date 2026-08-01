import type { ScheduledServiceRow } from './types.js';

const FORCE_RESOLVE_MS = 30 * 60 * 1000;

function rowKey(row: Pick<ScheduledServiceRow, 'direction' | 'scheduled_time'>): string {
  // Compare the normalized instant rather than the raw string: PostgREST
  // serializes timestamptz without milliseconds and with a +00:00 offset
  // (e.g. "2026-07-31T07:05:00+00:00"), while RTT-derived rows use
  // toISOString()'s ".000Z" format. Both can represent the same instant.
  return `${row.direction}|${new Date(row.scheduled_time).getTime()}`;
}

export function applyForceResolveFallback(
  existingPendingRows: ScheduledServiceRow[],
  freshRows: ScheduledServiceRow[],
  now: Date,
): ScheduledServiceRow[] {
  const freshKeys = new Set(freshRows.map(rowKey));
  const resolved: ScheduledServiceRow[] = [];

  for (const row of existingPendingRows) {
    if (freshKeys.has(rowKey(row))) continue;

    const timeSinceScheduled = now.getTime() - new Date(row.scheduled_time).getTime();
    if (timeSinceScheduled >= FORCE_RESOLVE_MS) {
      resolved.push({ ...row, status: 'cancelled' });
    }
  }

  return resolved;
}

export function dedupeRowsByNaturalKey(rows: ScheduledServiceRow[]): ScheduledServiceRow[] {
  const byKey = new Map<string, ScheduledServiceRow>();
  for (const row of rows) {
    byKey.set(`${row.service_date}|${row.direction}|${row.scheduled_time}`, row);
  }
  return [...byKey.values()];
}
