import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecentCancellationsTable } from '../components/RecentCancellationsTable';
import type { RecentCancellation } from '../lib/queries';

const rows: RecentCancellation[] = [
  { service_date: '2026-07-05', scheduled_time: '2026-07-05T07:03:00Z', direction: 'departing' },
  { service_date: '2026-07-04', scheduled_time: '2026-07-04T18:15:00Z', direction: 'arriving' },
];

describe('RecentCancellationsTable', () => {
  it('renders one row per cancellation with date, time, and direction', () => {
    render(<RecentCancellationsTable rows={rows} />);
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1); // + header row
    expect(screen.getByText('Departing')).toBeInTheDocument();
    expect(screen.getByText('Arriving')).toBeInTheDocument();
  });

  it('shows a message when there are no cancellations', () => {
    render(<RecentCancellationsTable rows={[]} />);
    expect(screen.getByText(/no cancellations/i)).toBeInTheDocument();
  });
});
