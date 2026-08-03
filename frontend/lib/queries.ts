import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aggregateStatusCounts,
  toPercentages,
  aggregateByPeakPeriod,
  aggregateTrendByDate,
  type StatusPercentages,
  type PeakComparisonRow,
  type TrendPoint,
} from './aggregate';
import type { DateRange } from './dateRange';
import type { Direction, Incident } from './types';

export type { Incident };

export async function fetchSummaryStats(
  client: SupabaseClient,
  range: DateRange,
): Promise<StatusPercentages> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('status')
    .gte('service_date', range.from)
    .lte('service_date', range.to);

  if (error) throw new Error(`fetchSummaryStats failed: ${error.message}`);
  return toPercentages(aggregateStatusCounts(data ?? []));
}

export async function fetchPeakComparison(
  client: SupabaseClient,
  range: DateRange,
): Promise<PeakComparisonRow[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('peak_period, status')
    .gte('service_date', range.from)
    .lte('service_date', range.to);

  if (error) throw new Error(`fetchPeakComparison failed: ${error.message}`);
  return aggregateByPeakPeriod(data ?? []);
}

export async function fetchTrend(client: SupabaseClient, range: DateRange): Promise<TrendPoint[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('service_date, status')
    .gte('service_date', range.from)
    .lte('service_date', range.to);

  if (error) throw new Error(`fetchTrend failed: ${error.message}`);
  return aggregateTrendByDate(data ?? []);
}

export async function fetchIncidents(
  client: SupabaseClient,
  range: DateRange,
  limit = 50,
): Promise<Incident[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('service_date, scheduled_time, direction, status, delay_minutes, cancel_reason, delay_reason, upstream_delay_minutes')
    .in('status', ['cancelled', 'delayed'])
    .gte('service_date', range.from)
    .lte('service_date', range.to)
    .order('scheduled_time', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchIncidents failed: ${error.message}`);
  return (data ?? []) as Incident[];
}

export type RecentCancellation = Incident;

export async function fetchRecentCancellations(
  client: SupabaseClient,
  range: DateRange,
  limit = 20,
): Promise<RecentCancellation[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('service_date, scheduled_time, direction')
    .eq('status', 'cancelled')
    .gte('service_date', range.from)
    .lte('service_date', range.to)
    .order('scheduled_time', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchRecentCancellations failed: ${error.message}`);
  return (data ?? []) as RecentCancellation[];
}
