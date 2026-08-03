import type React from 'react';
import type { StatusPercentages } from '@/lib/aggregate';
import type { ExecutiveStats } from '@/lib/queries';

interface ExecutiveKPIsProps {
  percentages: StatusPercentages;
  execStats: ExecutiveStats;
}

function KpiTile({ title, value, subtitle }: { title: string; value: React.ReactNode; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-widget)] backdrop-blur-md p-4 shadow-lg">
      <h3 className="text-sm font-medium text-[var(--text-secondary)]">{title}</h3>
      <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">{value}</div>
      {subtitle && <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>}
    </div>
  );
}

export function ExecutiveKPIs({ percentages, execStats }: ExecutiveKPIsProps) {
  if (percentages.total === 0) {
    return <div className="text-sm text-[var(--text-secondary)]">No data for this date range yet.</div>;
  }

  const topReason = execStats.reasons[0];
  const { origins, directions } = execStats;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        title="Strict On-Time"
        value={`${Math.round(percentages.onTimePercent)}%`}
        subtitle="0-minute tolerance"
      />
      <KpiTile
        title="Top Failure Reason"
        value={topReason ? topReason.reason : 'None'}
        subtitle={topReason ? `${topReason.count} incidents` : ''}
      />
      <KpiTile
        title="Delay Origin"
        value={<span className="text-lg">{origins.upstream} vs {origins.turnaround}</span>}
        subtitle="Upstream vs Turnaround"
      />
      <KpiTile
        title="Failures by Direction"
        value={<span className="text-lg">{directions.arriving} vs {directions.departing}</span>}
        subtitle="Arriving vs Departing"
      />
    </div>
  );
}
