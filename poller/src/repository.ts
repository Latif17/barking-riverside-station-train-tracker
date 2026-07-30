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

export async function fetchRecentlyResolvedRows(
  client: SupabaseClient,
  serviceDate: string,
  sinceIso: string,
): Promise<ScheduledServiceRow[]> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('*')
    .eq('service_date', serviceDate)
    .neq('status', 'pending')
    .gte('scheduled_time', sinceIso);

  if (error) throw new Error(`fetchRecentlyResolvedRows failed: ${error.message}`);
  return (data ?? []) as ScheduledServiceRow[];
}

export async function upsertRows(client: SupabaseClient, rows: ScheduledServiceRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from('scheduled_services').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`upsertRows failed: ${error.message}`);
}

export async function insertSeedRows(
  client: SupabaseClient,
  rows: ScheduledServiceRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from('scheduled_services').insert(rows);
  if (error) throw new Error(`insertSeedRows failed: ${error.message}`);
}

export async function rowsExistForDate(client: SupabaseClient, serviceDate: string): Promise<boolean> {
  const { data, error } = await client
    .from('scheduled_services')
    .select('id', { count: 'exact', head: false })
    .eq('service_date', serviceDate);

  if (error) throw new Error(`rowsExistForDate failed: ${error.message}`);
  return (data ?? []).length > 0;
}
