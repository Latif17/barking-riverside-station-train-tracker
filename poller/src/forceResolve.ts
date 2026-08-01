import type { ScheduledServiceRow } from './types.js';

const FORCE_RESOLVE_MS = 30 * 60 * 1000;

function rowKey(row: Pick<ScheduledServiceRow, 'direction' | 'scheduled_time'>): string {
  return `${row.direction}|${row.scheduled_time}`;
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
