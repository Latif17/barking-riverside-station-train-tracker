import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutiveKPIs } from '../components/ExecutiveKPIs';

describe('ExecutiveKPIs', () => {
  const dummyPercentages = {
    earlyPercent: 5.0,
    onTimePercent: 82.4,
    delayedPercent: 10.0,
    cancelledPercent: 2.6,
    total: 100,
  };

  const dummyExecStats = {
    reasons: [
      { reason: 'Signal Failure', count: 5 },
      { reason: 'Train Fault', count: 2 },
    ],
    origins: { upstream: 6, turnaround: 1 },
    directions: { arriving: 4, departing: 3 },
  };

  it('renders "No data for this date range yet." when percentages.total is 0', () => {
    render(
      <ExecutiveKPIs
        percentages={{ earlyPercent: 0, onTimePercent: 0, delayedPercent: 0, cancelledPercent: 0, total: 0 }}
        execStats={{ reasons: [], origins: { upstream: 0, turnaround: 0 }, directions: { arriving: 0, departing: 0 } }}
      />
    );
    expect(screen.getByText('No data for this date range yet.')).toBeInTheDocument();
  });

  it('renders executive KPI tiles when data is available', () => {
    render(<ExecutiveKPIs percentages={dummyPercentages} execStats={dummyExecStats} />);

    // Strict On-Time tile
    expect(screen.getByText('Strict On-Time')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('0-minute tolerance')).toBeInTheDocument();

    // Top Failure Reason tile
    expect(screen.getByText('Top Failure Reason')).toBeInTheDocument();
    expect(screen.getByText('Signal Failure')).toBeInTheDocument();
    expect(screen.getByText('5 incidents')).toBeInTheDocument();

    // Delay Origin tile
    expect(screen.getByText('Delay Origin')).toBeInTheDocument();
    expect(screen.getByText('6 vs 1')).toBeInTheDocument();
    expect(screen.getByText('Upstream vs Turnaround')).toBeInTheDocument();

    // Failures by Direction tile
    expect(screen.getByText('Failures by Direction')).toBeInTheDocument();
    expect(screen.getByText('4 vs 3')).toBeInTheDocument();
    expect(screen.getByText('Arriving vs Departing')).toBeInTheDocument();
  });

  it('renders "None" for top failure reason when reasons array is empty', () => {
    const noReasonStats = {
      ...dummyExecStats,
      reasons: [],
    };
    render(<ExecutiveKPIs percentages={dummyPercentages} execStats={noReasonStats} />);

    expect(screen.getByText('Top Failure Reason')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });
});
