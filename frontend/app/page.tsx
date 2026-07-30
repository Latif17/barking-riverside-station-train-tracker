'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { computeDateRange } from '@/lib/dateRange';
import { loadDashboardConfig, saveDashboardConfig, type DashboardConfig } from '@/lib/dashboardConfig';
import { fetchSummaryStats, fetchPeakComparison, fetchTrend, fetchRecentCancellations } from '@/lib/queries';
import type { StatusPercentages, PeakComparisonRow, TrendPoint } from '@/lib/aggregate';
import type { RecentCancellation } from '@/lib/queries';
import { StatTiles } from '@/components/StatTiles';
import { PeakComparisonChart } from '@/components/PeakComparisonChart';
import { TrendChart } from '@/components/TrendChart';
import { RecentCancellationsTable } from '@/components/RecentCancellationsTable';
import { DateRangeSelector } from '@/components/DateRangeSelector';
import { WidgetToggles } from '@/components/WidgetToggles';

interface DashboardData {
  stats: StatusPercentages;
  peakComparison: PeakComparisonRow[];
  trend: TrendPoint[];
  recentCancellations: RecentCancellation[];
}

export default function DashboardPage() {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfig(loadDashboardConfig());
  }, []);

  useEffect(() => {
    if (!config) return;

    let cancelled = false;
    setError(null);

    async function load() {
      try {
        const client = getSupabaseClient();
        const range = computeDateRange(config!.dateRangeDays);
        const [stats, peakComparison, trend, recentCancellations] = await Promise.all([
          fetchSummaryStats(client, range),
          fetchPeakComparison(client, range),
          fetchTrend(client, range),
          fetchRecentCancellations(client, range),
        ]);
        if (!cancelled) {
          setData({ stats, peakComparison, trend, recentCancellations });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [config]);

  if (!config) return null;

  function updateConfig(next: DashboardConfig) {
    setConfig(next);
    saveDashboardConfig(next);
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Barking Riverside Train Tracker
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          How often trains at Barking Riverside are cancelled or delayed, by time of day.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <DateRangeSelector
          value={config.dateRangeDays}
          onChange={(days) => updateConfig({ ...config, dateRangeDays: days })}
        />
        <a href="/report" className="text-sm text-[var(--series-trend)] underline">
          View printable report
        </a>
      </div>

      <div className="mb-6">
        <WidgetToggles
          visibleWidgets={config.visibleWidgets}
          onChange={(visibleWidgets) => updateConfig({ ...config, visibleWidgets })}
        />
      </div>

      {error && (
        <p className="mb-6 rounded-md border border-[var(--status-cancelled)] p-3 text-sm text-[var(--status-cancelled)]">
          {error}
        </p>
      )}

      {!error && !data && (
        <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
      )}

      {data && (
        <div className="space-y-8">
          {config.visibleWidgets.statTiles && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Overview</h2>
              <StatTiles percentages={data.stats} />
            </section>
          )}

          {config.visibleWidgets.peakComparison && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Peak vs off-peak</h2>
              <PeakComparisonChart rows={data.peakComparison} />
            </section>
          )}

          {config.visibleWidgets.trend && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Trend</h2>
              <TrendChart points={data.trend} />
            </section>
          )}

          {config.visibleWidgets.recentCancellations && (
            <section>
              <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Recent cancellations</h2>
              <RecentCancellationsTable rows={data.recentCancellations} />
            </section>
          )}
        </div>
      )}
    </main>
  );
}
