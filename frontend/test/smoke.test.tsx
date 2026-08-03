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

  it('renders the site title and, after loading, the overview section', async () => {
    render(<DashboardPage />);
    expect(screen.getByText('Barking Riverside Train Tracker')).toBeInTheDocument();
    expect(await screen.findByText('Overview')).toBeInTheDocument();
  });
});
