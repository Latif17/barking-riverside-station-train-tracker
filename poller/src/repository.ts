// poller/src/repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduledServiceRow } from './types.js';

export async function fetchPendingRows(
  client: SupabaseClient,
  serviceDate: string,
): Promise<ScheduledServiceRow[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('*')
    .eq('service_date', serviceDate)
    .eq('status', 'pending');

  if (error) throw new Error(`fetchPendingRows failed: ${error.message}`);
  return (data ?? []) as ScheduledServiceRow[];
}

export async function upsertScheduledServices(
  client: SupabaseClient,
  rows: ScheduledServiceRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const sanitizedRows = rows.map((row) => ({
    service_date: row.service_date,
    direction: row.direction,
    scheduled_time: row.scheduled_time,
    peak_period: row.peak_period,
    status: row.status,
    observed_time: row.observed_time ?? null,
    delay_minutes: row.delay_minutes ?? null,
    rtt_uid: row.rtt_uid ?? null,
  }));

  const { error } = await client
    .from('scheduled_services')
    .upsert(sanitizedRows, { onConflict: 'service_date,direction,scheduled_time' });
  if (error) throw new Error(`upsertScheduledServices failed: ${error.message}`);
}
