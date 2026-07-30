import type { StatusPercentages } from '@/lib/aggregate';

interface StatTilesProps {
  percentages: StatusPercentages;
}

function Tile({ label, value, colorVar }: { label: string; value: number; colorVar: string }) {
  return (
    <div className="rounded-lg border border-[var(--gridline)] bg-[var(--surface-1)] p-4">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: `var(${colorVar})` }}
          aria-hidden="true"
        />
        <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">
        {Math.round(value)}%
      </div>
    </div>
  );
}

export function StatTiles({ percentages }: StatTilesProps) {
  if (percentages.total === 0) {
    return (
      <div className="rounded-lg border border-[var(--gridline)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-secondary)]">
        No data for this date range yet.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="On time" value={percentages.onTimePercent} colorVar="--status-on-time" />
        <Tile label="Delayed" value={percentages.delayedPercent} colorVar="--status-delayed" />
        <Tile label="Cancelled" value={percentages.cancelledPercent} colorVar="--status-cancelled" />
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Based on {percentages.total} services in this range
      </p>
    </div>
  );
}
