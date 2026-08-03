import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles } from '../components/StatTiles';

describe('StatTiles', () => {
  it('renders early, on-time, delayed, and cancelled percentages', () => {
    render(
      <StatTiles
        percentages={{ earlyPercent: 4.8, onTimePercent: 77.7, delayedPercent: 12.3, cancelledPercent: 3.2, total: 120 }}
      />,
    );
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('3%')).toBeInTheDocument();
    expect(screen.getByText('Early')).toBeInTheDocument();
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows a based-on count', () => {
    render(
      <StatTiles
        percentages={{ earlyPercent: 0, onTimePercent: 100, delayedPercent: 0, cancelledPercent: 0, total: 42 }}
      />,
    );
    expect(screen.getByText(/42 services/)).toBeInTheDocument();
  });

  it('renders a message when there is no data', () => {
    render(
      <StatTiles
        percentages={{ earlyPercent: 0, onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 }}
      />,
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
