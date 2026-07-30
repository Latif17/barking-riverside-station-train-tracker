import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendChart } from '../components/TrendChart';
import type { TrendPoint } from '../lib/aggregate';

const points: TrendPoint[] = [
  { date: '2026-07-01', cancellationRatePercent: 0, total: 20 },
  { date: '2026-07-02', cancellationRatePercent: 5, total: 22 },
  { date: '2026-07-03', cancellationRatePercent: 15, total: 19 },
];

describe('TrendChart', () => {
  it('renders an SVG path for the trend line', () => {
    const { container } = render(<TrendChart points={points} />);
    const path = container.querySelector('svg path[data-testid="trend-line"]');
    expect(path).toBeInTheDocument();
    expect(path?.getAttribute('d')).toMatch(/^M /);
  });

  it('shows a no-data message when there are no points', () => {
    render(<TrendChart points={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('labels the chart with a title identifying the single series (no legend needed)', () => {
    render(<TrendChart points={points} />);
    expect(screen.getByText(/cancellation rate/i)).toBeInTheDocument();
  });
});
