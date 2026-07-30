import { computeLineChart } from '@/lib/chartGeometry';
import type { TrendPoint } from '@/lib/aggregate';

const CHART_WIDTH = 480;
const CHART_HEIGHT = 140;

interface TrendChartProps {
  points: TrendPoint[];
}

export function TrendChart({ points }: TrendChartProps) {
  if (points.length === 0) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">No data for this date range yet.</div>
    );
  }

  const geometry = computeLineChart(points, CHART_WIDTH, CHART_HEIGHT);
  const lastPoint = geometry.points[geometry.points.length - 1];

  return (
    <div>
      <p className="mb-1 text-sm text-[var(--text-secondary)]">Daily cancellation rate</p>
      <svg
        width={CHART_WIDTH}
        height={CHART_HEIGHT + 8}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT + 8}`}
        role="img"
        aria-label="Daily cancellation rate trend"
      >
        <line
          x1={0}
          y1={CHART_HEIGHT}
          x2={CHART_WIDTH}
          y2={CHART_HEIGHT}
          stroke="var(--gridline)"
          strokeWidth={1}
        />
        <path
          data-testid="trend-line"
          d={geometry.pathD}
          fill="none"
          stroke="var(--series-trend)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {lastPoint && (
          <>
            <circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={4}
              fill="var(--series-trend)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <text
              x={Math.min(lastPoint.x, CHART_WIDTH - 32)}
              y={Math.max(lastPoint.y - 8, 12)}
              textAnchor="end"
              fontSize={12}
              fill="var(--text-secondary)"
            >
              {Math.round(lastPoint.value)}%
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
