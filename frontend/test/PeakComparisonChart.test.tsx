import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeakComparisonChart } from '../components/PeakComparisonChart';
import type { PeakComparisonRow } from '../lib/aggregate';

const rows: PeakComparisonRow[] = [
  {
    peakPeriod: 'am_peak',
    counts: { early: 5, onTime: 75, delayed: 15, cancelled: 5, pending: 0, total: 100 },
    percentages: { earlyPercent: 5, onTimePercent: 75, delayedPercent: 15, cancelledPercent: 5, total: 100 },
  },
  {
    peakPeriod: 'pm_peak',
    counts: { early: 10, onTime: 60, delayed: 20, cancelled: 10, pending: 0, total: 100 },
    percentages: { earlyPercent: 10, onTimePercent: 60, delayedPercent: 20, cancelledPercent: 10, total: 100 },
  },
  {
    peakPeriod: 'off_peak',
    counts: { early: 2, onTime: 88, delayed: 8, cancelled: 2, pending: 0, total: 100 },
    percentages: { earlyPercent: 2, onTimePercent: 88, delayedPercent: 8, cancelledPercent: 2, total: 100 },
  },
];

describe('PeakComparisonChart', () => {
  it('renders a labelled bar for each peak period', () => {
    render(<PeakComparisonChart rows={rows} />);
    expect(screen.getByText('AM peak')).toBeInTheDocument();
    expect(screen.getByText('PM peak')).toBeInTheDocument();
    expect(screen.getByText('Off-peak')).toBeInTheDocument();
  });

  it('renders an SVG with one rect per non-zero segment (12 total for 3 full bars)', () => {
    const { container } = render(<PeakComparisonChart rows={rows} />);
    const rects = container.querySelectorAll('svg rect[data-status]');
    expect(rects).toHaveLength(12);
  });

  it('renders a legend identifying the four statuses', () => {
    render(<PeakComparisonChart rows={rows} />);
    expect(screen.getByText('Early')).toBeInTheDocument();
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows a no-data message for a peak period with zero services', () => {
    const withEmpty = rows.map((r) =>
      r.peakPeriod === 'pm_peak'
        ? { ...r, counts: { ...r.counts, total: 0 }, percentages: { earlyPercent: 0, onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 } }
        : r,
    );
    render(<PeakComparisonChart rows={withEmpty} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
