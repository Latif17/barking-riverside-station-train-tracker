'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { computeDateRange } from '@/lib/dateRange';
import { fetchSummaryStats, fetchPeakComparison, fetchTrend } from '@/lib/queries';
import type { StatusPercentages, PeakComparisonRow, TrendPoint } from '@/lib/aggregate';
import { StatTiles } from '@/components/StatTiles';
import { PeakComparisonChart } from '@/components/PeakComparisonChart';
import { TrendChart } from '@/components/TrendChart';

const REPORT_DAYS = 90;

interface ReportData {
  stats: StatusPercentages;
  peakComparison: PeakComparisonRow[];
  trend: TrendPoint[];
}

export default function ReportPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = computeDateRange(REPORT_DAYS);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const client = getSupabaseClient();
        const [stats, peakComparison, trend] = await Promise.all([
          fetchSummaryStats(client, range),
          fetchPeakComparison(client, range),
          fetchTrend(client, range),
        ]);
        if (!cancelled) setData({ stats, peakComparison, trend });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report data');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      data-theme="light"
      className="mx-auto max-w-3xl bg-[var(--surface-1)] p-8 print:p-0"
    >
      <style>{`
        @media print {
          .no-print { display: none; }
        }
      `}</style>

      <div className="no-print mb-6">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-[var(--gridline)] px-3 py-1.5 text-sm text-[var(--text-secondary)]"
        >
          Print / Save as PDF
        </button>
      </div>

      <header className="mb-6 border-b border-[var(--gridline)] pb-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Barking Riverside Train Reliability Report
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {range.from} to {range.to} ({REPORT_DAYS} days)
        </p>
      </header>

      {error && <p className="text-sm text-[var(--status-cancelled)]">{error}</p>}
      {!error && !data && <p className="text-sm text-[var(--text-secondary)]">Loading…</p>}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Overview</h2>
            <StatTiles percentages={data.stats} />
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Peak vs off-peak</h2>
            <PeakComparisonChart rows={data.peakComparison} />
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Trend</h2>
            <TrendChart points={data.trend} />
          </section>
        </div>
      )}
    </main>
  );
}
