export interface StackedSegment {
  status: 'cancelled' | 'delayed' | 'early' | 'onTime';
  y: number;
  height: number;
}

export interface StackedBar {
  label: string;
  x: number;
  width: number;
  segments: StackedSegment[];
}

interface GroupPercentages {
  earlyPercent: number;
  onTimePercent: number;
  delayedPercent: number;
  cancelledPercent: number;
}

export function computeStackedBars(
  groups: { label: string; percentages: GroupPercentages }[],
  chartHeight: number,
  barWidth: number,
  barGap: number,
): StackedBar[] {
  return groups.map((group, i) => {
    const x = i * (barWidth + barGap);
    const segmentDefs: Array<['cancelled' | 'delayed' | 'early' | 'onTime', number]> = [
      ['cancelled', group.percentages.cancelledPercent],
      ['delayed', group.percentages.delayedPercent],
      ['early', group.percentages.earlyPercent],
      ['onTime', group.percentages.onTimePercent],
    ];

    let cursorY = chartHeight;
    const segments: StackedSegment[] = [];
    for (const [status, percent] of segmentDefs) {
      const height = (percent / 100) * chartHeight;
      if (height <= 0) continue;
      cursorY -= height;
      segments.push({ status, y: cursorY, height });
    }

    return { label: group.label, x, width: barWidth, segments };
  });
}

export interface LinePoint {
  x: number;
  y: number;
  date: string;
  value: number;
}

export interface LineChartGeometry {
  points: LinePoint[];
  pathD: string;
  maxValue: number;
}

export function computeLineChart(
  data: { date: string; cancellationRatePercent: number }[],
  width: number,
  height: number,
): LineChartGeometry {
  if (data.length === 0) {
    return { points: [], pathD: '', maxValue: 0 };
  }

  // Floor at 10% so an all-good period doesn't render as a flat line pinned to
  // the very top of the chart (which would visually look "maxed out" rather
  // than "zero").
  const maxValue = Math.max(10, ...data.map((d) => d.cancellationRatePercent));
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points: LinePoint[] = data.map((d, i) => ({
    x: data.length > 1 ? i * stepX : width / 2,
    y: height - (d.cancellationRatePercent / maxValue) * height,
    date: d.date,
    value: d.cancellationRatePercent,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

  return { points, pathD, maxValue };
}
