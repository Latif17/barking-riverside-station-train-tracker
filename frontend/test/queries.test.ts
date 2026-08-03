import { describe, it, expect, vi } from 'vitest';
import { fetchSummaryStats, fetchPeakComparison, fetchTrend, fetchRecentCancellations, fetchIncidents } from '../lib/queries';

// fetchSummaryStats/fetchPeakComparison/fetchTrend all call select().gte().lte()
// with no .eq() in the chain - this mock matches exactly that shape.
function makeRangeQueryClient(overrides: Record<string, any> = {}) {
  const data = overrides.data ?? [];
  const error = overrides.error ?? null;
  const lte = vi.fn().mockResolvedValue({ data, error });
  const gte = vi.fn().mockReturnValue({ lte });
  const select = vi.fn().mockReturnValue({ gte });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, gte, lte };
}

// fetchRecentCancellations calls select().eq().gte().lte().order().limit() - a
// longer, differently-shaped chain, so it gets its own purpose-built mock rather
// than overloading the one above with branches for both shapes.
function makeCancellationsQueryClient(overrides: Record<string, any> = {}) {
  const data = overrides.data ?? [];
  const error = overrides.error ?? null;
  const limit = vi.fn().mockResolvedValue({ data, error });
  const order = vi.fn().mockReturnValue({ limit });
  const lte = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ lte });
  const eq = vi.fn().mockReturnValue({ gte });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, eq, gte, lte, order, limit };
}

describe('fetchSummaryStats', () => {
  it('queries status in the date range and aggregates to percentages', async () => {
    const rows = [{ status: 'on_time' }, { status: 'cancelled' }];
    const { client, from, select, gte, lte } = makeRangeQueryClient({ data: rows });
    const result = await fetchSummaryStats(client, { from: '2026-07-01', to: '2026-07-31' });

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(select).toHaveBeenCalledWith('status');
    expect(gte).toHaveBeenCalledWith('service_date', '2026-07-01');
    expect(lte).toHaveBeenCalledWith('service_date', '2026-07-31');
    expect(result.total).toBe(2);
    expect(result.onTimePercent).toBeCloseTo(50);
  });

  it('throws a descriptive error when Supabase returns an error', async () => {
    const { client } = makeRangeQueryClient({ error: { message: 'boom' } });
    await expect(fetchSummaryStats(client, { from: '2026-07-01', to: '2026-07-31' })).rejects.toThrow(/boom/);
  });
});

describe('fetchPeakComparison', () => {
  it('queries peak_period + status and returns 3 buckets', async () => {
    const rows = [
      { peak_period: 'am_peak', status: 'on_time' },
      { peak_period: 'pm_peak', status: 'delayed' },
    ];
    const { client, select } = makeRangeQueryClient({ data: rows });
    const result = await fetchPeakComparison(client, { from: '2026-07-01', to: '2026-07-31' });

    expect(select).toHaveBeenCalledWith('peak_period, status');
    expect(result).toHaveLength(3);
  });
});

describe('fetchTrend', () => {
  it('queries service_date + status and returns points sorted by date', async () => {
    const rows = [
      { service_date: '2026-07-02', status: 'on_time' },
      { service_date: '2026-07-01', status: 'cancelled' },
    ];
    const { client, select } = makeRangeQueryClient({ data: rows });
    const result = await fetchTrend(client, { from: '2026-07-01', to: '2026-07-31' });

    expect(select).toHaveBeenCalledWith('service_date, status');
    expect(result.map((t) => t.date)).toEqual(['2026-07-01', '2026-07-02']);
  });
});

function makeIncidentsQueryClient(overrides: Record<string, any> = {}) {
  const data = overrides.data ?? [];
  const error = overrides.error ?? null;
  const limit = vi.fn().mockResolvedValue({ data, error });
  const order = vi.fn().mockReturnValue({ limit });
  const lte = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ lte });
  const inClause = vi.fn().mockReturnValue({ gte });
  const select = vi.fn().mockReturnValue({ in: inClause });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, inClause, gte, lte, order, limit };
}

describe('fetchIncidents', () => {
  it('queries cancelled and delayed rows with reason columns, ordered by scheduled_time descending, with limit', async () => {
    const rows = [
      {
        service_date: '2026-07-05',
        scheduled_time: '2026-07-05T07:00:00Z',
        direction: 'departing',
        status: 'cancelled',
        delay_minutes: null,
        cancel_reason: 'Signal failure',
        delay_reason: null,
        upstream_delay_minutes: null,
      },
    ];
    const { client, select, inClause, gte, lte, order, limit } = makeIncidentsQueryClient({ data: rows });
    const result = await fetchIncidents(client, { from: '2026-07-01', to: '2026-07-31' }, 10);

    expect(select).toHaveBeenCalledWith(
      'service_date, scheduled_time, direction, status, delay_minutes, cancel_reason, delay_reason, upstream_delay_minutes',
    );
    expect(inClause).toHaveBeenCalledWith('status', ['cancelled', 'delayed']);
    expect(gte).toHaveBeenCalledWith('service_date', '2026-07-01');
    expect(lte).toHaveBeenCalledWith('service_date', '2026-07-31');
    expect(order).toHaveBeenCalledWith('scheduled_time', { ascending: false });
    expect(limit).toHaveBeenCalledWith(10);
    expect(result).toEqual(rows);
  });

  it('defaults to a limit of 50 when none is given', async () => {
    const { client, limit } = makeIncidentsQueryClient({ data: [] });
    await fetchIncidents(client, { from: '2026-07-01', to: '2026-07-31' });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('throws a descriptive error when Supabase returns an error', async () => {
    const { client } = makeIncidentsQueryClient({ error: { message: 'DB connection error' } });
    await expect(fetchIncidents(client, { from: '2026-07-01', to: '2026-07-31' })).rejects.toThrow(
      /fetchIncidents failed: DB connection error/,
    );
  });
});

describe('fetchRecentCancellations', () => {
  it('queries cancelled rows, ordered by scheduled_time descending, with a limit', async () => {
    const rows = [{ service_date: '2026-07-05', scheduled_time: '2026-07-05T07:00:00Z', direction: 'departing' }];
    const { client, select, eq, gte, lte, order, limit } = makeCancellationsQueryClient({ data: rows });
    const result = await fetchRecentCancellations(client, { from: '2026-07-01', to: '2026-07-31' }, 10);

    expect(select).toHaveBeenCalledWith('service_date, scheduled_time, direction');
    expect(eq).toHaveBeenCalledWith('status', 'cancelled');
    expect(gte).toHaveBeenCalledWith('service_date', '2026-07-01');
    expect(lte).toHaveBeenCalledWith('service_date', '2026-07-31');
    expect(order).toHaveBeenCalledWith('scheduled_time', { ascending: false });
    expect(limit).toHaveBeenCalledWith(10);
    expect(result).toEqual(rows);
  });

  it('defaults to a limit of 20 when none is given', async () => {
    const { client, limit } = makeCancellationsQueryClient({ data: [] });
    await fetchRecentCancellations(client, { from: '2026-07-01', to: '2026-07-31' });
    expect(limit).toHaveBeenCalledWith(20);
  });
});

