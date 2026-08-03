import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        // fetchSummaryStats/fetchPeakComparison/fetchTrend: select().gte().lte()
        gte: () => ({
          lte: () => Promise.resolve({ data: [], error: null }),
        }),
        // fetchIncidents: select().in().gte().lte().order().limit()
        in: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
            }),
          }),
        }),
        // fetchRecentCancellations: select().eq().gte().lte().order().limit()
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import DashboardPage from '../app/page';

describe('DashboardPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the site title and, after loading, the Executive KPIs section', async () => {
    render(<DashboardPage />);
    expect(screen.getByText('Barking Riverside Train Tracker')).toBeInTheDocument();
    expect(await screen.findByText('Executive KPIs')).toBeInTheDocument();
  });

  it('renders Failure Reasons Breakdown section when reasons exist', async () => {
    // In our mock, when data has items with cancel_reason/delay_reason:
    vi.spyOn(await import('@/lib/queries'), 'fetchExecutiveStats').mockResolvedValueOnce({
      reasons: [{ reason: 'Signal Failure', count: 3, percentage: 100 }],
      origins: { inbound: { delayed: 0, total: 0 }, outbound: { delayed: 0, total: 0 } },
      directions: { inbound: { total: 0, cancelled: 0, delayed: 0 }, outbound: { total: 0, cancelled: 0, delayed: 0 } },
    });

    render(<DashboardPage />);
    expect(await screen.findByText('Failure Reasons Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Signal Failure')).toBeInTheDocument();
  });
});
