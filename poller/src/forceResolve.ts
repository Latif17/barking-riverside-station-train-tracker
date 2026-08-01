import type { ScheduledServiceRow } from './types.js';

const FORCE_RESOLVE_MS = 30 * 60 * 1000;

function rowKey(row: Pick<ScheduledServiceRow, 'direction' | 'rtt_uid'>): string {
  return `${row.direction}|${row.rtt_uid}`;
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
    byKey.set(`${row.service_date}|${row.direction}|${row.rtt_uid}`, row);
  }
  return [...byKey.values()];
}

export function dedupeByScheduledTime(rows: ScheduledServiceRow[]): {
  keep: ScheduledServiceRow[];
  drop: ScheduledServiceRow[];
} {
  const byTime = new Map<string, ScheduledServiceRow[]>();
  for (const row of rows) {
    const key = `${row.service_date}|${row.direction}|${row.scheduled_time}`;
    const group = byTime.get(key) ?? [];
    group.push(row);
    byTime.set(key, group);
  }

  const keep: ScheduledServiceRow[] = [];
  const drop: ScheduledServiceRow[] = [];

  for (const group of byTime.values()) {
    if (group.length === 1) {
      keep.push(group[0]);
    } else {
      const nonCancelled = group.filter((r) => r.status !== 'cancelled');
      const winner = nonCancelled.length > 0
        ? nonCancelled[nonCancelled.length - 1]
        : group[group.length - 1];

      keep.push(winner);
      for (const row of group) {
        if (row.rtt_uid !== winner.rtt_uid) {
          drop.push(row);
        }
      }
    }
  }

  return { keep, drop };
}
