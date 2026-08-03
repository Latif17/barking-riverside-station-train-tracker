import { computeStackedBars } from '@/lib/chartGeometry';
import type { PeakComparisonRow } from '@/lib/aggregate';

const CHART_HEIGHT = 160;
const BAR_WIDTH = 64;
const BAR_GAP = 40;

const PEAK_LABELS: Record<PeakComparisonRow['peakPeriod'], string> = {
  am_peak: 'AM peak',
  pm_peak: 'PM peak',
  off_peak: 'Off-peak',
};

const STATUS_COLOR_VAR: Record<'early' | 'onTime' | 'delayed' | 'cancelled', string> = {
  early: '--status-early',
  onTime: '--status-on-time',
  delayed: '--status-delayed',
  cancelled: '--status-cancelled',
};

const STATUS_LABEL: Record<'early' | 'onTime' | 'delayed' | 'cancelled', string> = {
  early: 'Early',
  onTime: 'On time',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
};

interface PeakComparisonChartProps {
  rows: PeakComparisonRow[];
}

export function PeakComparisonChart({ rows }: PeakComparisonChartProps) {
  const emptyPeriods = rows.filter((r) => r.percentages.total === 0);

  const groups = rows.map((r) => ({ label: PEAK_LABELS[r.peakPeriod], percentages: r.percentages }));
  const bars = computeStackedBars(groups, CHART_HEIGHT, BAR_WIDTH, BAR_GAP);
  const chartWidth = bars.length * BAR_WIDTH + (bars.length - 1) * BAR_GAP;

  return (
    <div>
      <svg
        width={chartWidth}
        height={CHART_HEIGHT + 24}
        viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT + 24}`}
        role="img"
        aria-label="On-time, delayed, and cancelled percentage by peak period"
      >
        <line
          x1={0}
          y1={CHART_HEIGHT}
          x2={chartWidth}
          y2={CHART_HEIGHT}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        {bars.map((bar) => (
          <g key={bar.label}>
            {bar.segments.map((segment) => (
              <rect
                key={segment.status}
                data-status={segment.status}
                x={bar.x}
                y={segment.y}
                width={bar.width}
                height={segment.height}
                rx={4}
                fill={`var(${STATUS_COLOR_VAR[segment.status]})`}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            ))}
            <text
              x={bar.x + bar.width / 2}
              y={CHART_HEIGHT + 18}
              textAnchor="middle"
              fontSize={12}
              fill="var(--text-secondary)"
            >
              {bar.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex gap-4 text-xs text-[var(--text-secondary)]">
        {(['onTime', 'delayed', 'cancelled'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: `var(${STATUS_COLOR_VAR[status]})` }}
              aria-hidden="true"
            />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>

      {emptyPeriods.length > 0 && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          No data yet for: {emptyPeriods.map((r) => PEAK_LABELS[r.peakPeriod]).join(', ')}
        </p>
      )}
    </div>
  );
}
