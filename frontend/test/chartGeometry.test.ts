import { describe, it, expect } from 'vitest';
import { computeStackedBars, computeLineChart } from '../lib/chartGeometry';

describe('computeStackedBars', () => {
  it('produces one bar per group, positioned left to right with the given gap', () => {
    const groups = [
      { label: 'AM peak', percentages: { onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0 } },
      { label: 'PM peak', percentages: { onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0 } },
    ];
    const bars = computeStackedBars(groups, 200, 24, 16);
    expect(bars).toHaveLength(2);
    expect(bars[0].x).toBe(0);
    expect(bars[1].x).toBe(24 + 16);
    expect(bars[0].width).toBe(24);
  });

  it('stacks segments bottom-to-top as cancelled, delayed, on_time, sized by percentage of chart height', () => {
    const groups = [
      { label: 'Off-peak', percentages: { onTimePercent: 70, delayedPercent: 20, cancelledPercent: 10 } },
    ];
    const [bar] = computeStackedBars(groups, 100, 24, 16);
    expect(bar.segments).toHaveLength(3);

    const cancelled = bar.segments.find((s) => s.status === 'cancelled')!;
    const delayed = bar.segments.find((s) => s.status === 'delayed')!;
    const onTime = bar.segments.find((s) => s.status === 'onTime')!;

    expect(cancelled.height).toBeCloseTo(10);
    expect(delayed.height).toBeCloseTo(20);
    expect(onTime.height).toBeCloseTo(70);

    // cancelled sits at the very bottom of a 100px-tall chart
    expect(cancelled.y).toBeCloseTo(90);
    // on_time sits at the very top
    expect(onTime.y).toBeCloseTo(0);
  });

  it('omits a segment entirely when its percentage is zero', () => {
    const groups = [
      { label: 'AM peak', percentages: { onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0 } },
    ];
    const [bar] = computeStackedBars(groups, 100, 24, 16);
    expect(bar.segments).toHaveLength(1);
    expect(bar.segments[0].status).toBe('onTime');
  });
});

describe('computeLineChart', () => {
  it('returns empty geometry for no data', () => {
    const geom = computeLineChart([], 300, 100);
    expect(geom.points).toEqual([]);
    expect(geom.pathD).toBe('');
  });

  it('spaces points evenly across the width and scales y to the height', () => {
    const data = [
      { date: '2026-07-01', cancellationRatePercent: 0 },
      { date: '2026-07-02', cancellationRatePercent: 50 },
    ];
    const geom = computeLineChart(data, 300, 100);
    expect(geom.points).toHaveLength(2);
    expect(geom.points[0].x).toBe(0);
    expect(geom.points[1].x).toBe(300);
    // maxValue floors at 10, but 50 > 10 so maxValue is 50; y=0 -> bottom (height), y=50 -> top (0)
    expect(geom.maxValue).toBe(50);
    expect(geom.points[0].y).toBeCloseTo(100);
    expect(geom.points[1].y).toBeCloseTo(0);
  });

  it('floors maxValue at 10 so an all-zero series does not render a flat line pinned to the top', () => {
    const data = [
      { date: '2026-07-01', cancellationRatePercent: 0 },
      { date: '2026-07-02', cancellationRatePercent: 0 },
    ];
    const geom = computeLineChart(data, 300, 100);
    expect(geom.maxValue).toBe(10);
    expect(geom.points[0].y).toBeCloseTo(100);
  });

  it('builds a valid SVG path string starting with M and using L for subsequent points', () => {
    const data = [
      { date: '2026-07-01', cancellationRatePercent: 0 },
      { date: '2026-07-02', cancellationRatePercent: 20 },
      { date: '2026-07-03', cancellationRatePercent: 10 },
    ];
    const geom = computeLineChart(data, 200, 100);
    expect(geom.pathD.startsWith('M ')).toBe(true);
    expect(geom.pathD.split(' L ')).toHaveLength(3); // "M x y" + 2 "L x y" segments
  });
});
