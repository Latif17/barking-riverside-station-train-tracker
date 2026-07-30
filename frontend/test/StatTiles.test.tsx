import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles } from '../components/StatTiles';

describe('StatTiles', () => {
  it('renders on-time, delayed, and cancelled percentages', () => {
    render(
      <StatTiles
        percentages={{ onTimePercent: 82.5, delayedPercent: 12.3, cancelledPercent: 5.2, total: 120 }}
      />,
    );
    expect(screen.getByText('83%')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows a based-on count', () => {
    render(
      <StatTiles
        percentages={{ onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0, total: 42 }}
      />,
    );
    expect(screen.getByText(/42 services/)).toBeInTheDocument();
  });

  it('renders a message when there is no data', () => {
    render(
      <StatTiles
        percentages={{ onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 }}
      />,
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
