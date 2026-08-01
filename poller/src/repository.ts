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

  const sanitizedRows = rows.map((row) => {
    const { id, ...rest } = row;
    return rest;
  });

  const { error } = await client
    .from('scheduled_services')
    .upsert(sanitizedRows, { onConflict: 'service_date,direction,scheduled_time' });
  if (error) throw new Error(`upsertScheduledServices failed: ${error.message}`);
}
