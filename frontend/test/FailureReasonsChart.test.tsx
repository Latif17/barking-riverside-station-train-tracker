import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FailureReasonsChart } from '../components/FailureReasonsChart';

describe('FailureReasonsChart', () => {
  it('renders fallback message when reasons array is empty', () => {
    render(<FailureReasonsChart reasons={[]} />);
    expect(screen.getByText('No recorded failure reasons.')).toBeInTheDocument();
  });

  it('renders up to 10 failure reasons with bar representation and count', () => {
    const dummyReasons = [
      { reason: 'Signal Failure', count: 10 },
      { reason: 'Train Fault', count: 5 },
      { reason: 'Points Failure', count: 2 },
    ];

    render(<FailureReasonsChart reasons={dummyReasons} />);

    expect(screen.getByText('Signal Failure')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();

    expect(screen.getByText('Train Fault')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    expect(screen.getByText('Points Failure')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('truncates reasons list to top 10 items', () => {
    const twelveReasons = Array.from({ length: 12 }, (_, i) => ({
      reason: `Reason ${i + 1}`,
      count: 20 - i,
    }));

    render(<FailureReasonsChart reasons={twelveReasons} />);

    expect(screen.getByText('Reason 1')).toBeInTheDocument();
    expect(screen.getByText('Reason 10')).toBeInTheDocument();
    expect(screen.queryByText('Reason 11')).not.toBeInTheDocument();
    expect(screen.queryByText('Reason 12')).not.toBeInTheDocument();
  });
});
