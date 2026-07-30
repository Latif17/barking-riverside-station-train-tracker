import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeakComparisonChart } from '../components/PeakComparisonChart';
import type { PeakComparisonRow } from '../lib/aggregate';

const rows: PeakComparisonRow[] = [
  {
    peakPeriod: 'am_peak',
    counts: { onTime: 80, delayed: 15, cancelled: 5, pending: 0, total: 100 },
    percentages: { onTimePercent: 80, delayedPercent: 15, cancelledPercent: 5, total: 100 },
  },
  {
    peakPeriod: 'pm_peak',
    counts: { onTime: 70, delayed: 20, cancelled: 10, pending: 0, total: 100 },
    percentages: { onTimePercent: 70, delayedPercent: 20, cancelledPercent: 10, total: 100 },
  },
  {
    peakPeriod: 'off_peak',
    counts: { onTime: 90, delayed: 8, cancelled: 2, pending: 0, total: 100 },
    percentages: { onTimePercent: 90, delayedPercent: 8, cancelledPercent: 2, total: 100 },
  },
];

describe('PeakComparisonChart', () => {
  it('renders a labelled bar for each peak period', () => {
    render(<PeakComparisonChart rows={rows} />);
    expect(screen.getByText('AM peak')).toBeInTheDocument();
    expect(screen.getByText('PM peak')).toBeInTheDocument();
    expect(screen.getByText('Off-peak')).toBeInTheDocument();
  });

  it('renders an SVG with one rect per non-zero segment (9 total for 3 full bars)', () => {
    const { container } = render(<PeakComparisonChart rows={rows} />);
    const rects = container.querySelectorAll('svg rect[data-status]');
    expect(rects).toHaveLength(9);
  });

  it('renders a legend identifying the three statuses', () => {
    render(<PeakComparisonChart rows={rows} />);
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows a no-data message for a peak period with zero services', () => {
    const withEmpty = rows.map((r) =>
      r.peakPeriod === 'pm_peak'
        ? { ...r, counts: { ...r.counts, total: 0 }, percentages: { onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 } }
        : r,
    );
    render(<PeakComparisonChart rows={withEmpty} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
