import type { PeakPeriod } from './types';

export interface StatusCounts {
  onTime: number;
  delayed: number;
  cancelled: number;
  pending: number;
  total: number;
}

export interface StatusPercentages {
  onTimePercent: number;
  delayedPercent: number;
  cancelledPercent: number;
  total: number;
}

export function aggregateStatusCounts(rows: { status: string }[]): StatusCounts {
  const counts: StatusCounts = { onTime: 0, delayed: 0, cancelled: 0, pending: 0, total: 0 };
  for (const row of rows) {
    counts.total += 1;
    if (row.status === 'on_time') counts.onTime += 1;
    else if (row.status === 'delayed') counts.delayed += 1;
    else if (row.status === 'cancelled') counts.cancelled += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function toPercentages(counts: StatusCounts): StatusPercentages {
  // Percentages are of RESOLVED services (on_time + delayed + cancelled).
  // Pending services haven't happened yet, so they aren't a reliability outcome.
  const resolved = counts.onTime + counts.delayed + counts.cancelled;
  if (resolved === 0) {
    return { onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 };
  }
  return {
    onTimePercent: (counts.onTime / resolved) * 100,
    delayedPercent: (counts.delayed / resolved) * 100,
    cancelledPercent: (counts.cancelled / resolved) * 100,
    total: resolved,
  };
}

export interface PeakComparisonRow {
  peakPeriod: PeakPeriod;
  counts: StatusCounts;
  percentages: StatusPercentages;
}

const PEAK_PERIODS: PeakPeriod[] = ['am_peak', 'pm_peak', 'off_peak'];

export function aggregateByPeakPeriod(
  rows: { peak_period: string; status: string }[],
): PeakComparisonRow[] {
  return PEAK_PERIODS.map((peakPeriod) => {
    const filtered = rows.filter((r) => r.peak_period === peakPeriod);
    const counts = aggregateStatusCounts(filtered);
    return { peakPeriod, counts, percentages: toPercentages(counts) };
  });
}

export interface TrendPoint {
  date: string;
  cancellationRatePercent: number;
  total: number;
}

export function aggregateTrendByDate(rows: { service_date: string; status: string }[]): TrendPoint[] {
  const byDate = new Map<string, { status: string }[]>();
  for (const row of rows) {
    const list = byDate.get(row.service_date) ?? [];
    list.push(row);
    byDate.set(row.service_date, list);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => {
      const counts = aggregateStatusCounts(dayRows);
      const resolved = counts.onTime + counts.delayed + counts.cancelled;
      const cancellationRatePercent = resolved === 0 ? 0 : (counts.cancelled / resolved) * 100;
      return { date, cancellationRatePercent, total: resolved };
    });
}
