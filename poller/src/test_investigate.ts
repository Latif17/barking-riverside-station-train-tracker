import { readFileSync } from 'fs';
const envFile = readFileSync('.env', 'utf-8');
for (const line of envFile.split('\n')) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...vals] = line.split('=');
    let val = vals.join('=').trim();
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    process.env[key.trim()] = val;
  }
}

import { loadConfig } from './config.js';
import { createSupabaseClient } from './supabaseClient.js';
import { getScheduledServicesForDate } from './schedule.js';

async function main() {
  const config = loadConfig();
  const client = createSupabaseClient(config);
  
  const { data: record } = await client
    .from('scheduled_services')
    .select('*')
    .eq('id', 'be353562-d5d9-444d-a2a5-0f92fecc27cf')
    .single();
    
  console.log('Suspicious Record:');
  console.log(record);
  
  // Also let's check which trains are missing
  const serviceDate = '2026-08-03';
  const { data: allRows } = await client
    .from('scheduled_services')
    .select('*')
    .eq('service_date', serviceDate);
    
  const dbDeparting = allRows.filter(r => r.direction === 'departing');
  const dbArriving = allRows.filter(r => r.direction === 'arriving');
  
  console.log(`DB Counts: ${dbDeparting.length} departing, ${dbArriving.length} arriving`);
  
  const expectedRows = getScheduledServicesForDate(serviceDate);
  const expectedDeparting = expectedRows.filter(r => r.direction === 'departing').map(r => r.scheduled_time);
  const expectedArriving = expectedRows.filter(r => r.direction === 'arriving').map(r => r.scheduled_time);
  
  const dbDepartingTimes = new Set(dbDeparting.map(r => new Date(r.scheduled_time).getTime()));
  const dbArrivingTimes = new Set(dbArriving.map(r => new Date(r.scheduled_time).getTime()));
  
  const missingDeparting = expectedDeparting.filter(t => !dbDepartingTimes.has(new Date(t).getTime()));
  const missingArriving = expectedArriving.filter(t => !dbArrivingTimes.has(new Date(t).getTime()));
  
  console.log('Missing departing:');
  console.log(missingDeparting.map(t => new Date(t).toLocaleTimeString('en-GB', {timeZone: 'Europe/London'})));
  
  console.log('Missing arriving:');
  console.log(missingArriving.map(t => new Date(t).toLocaleTimeString('en-GB', {timeZone: 'Europe/London'})));
  
}
main().catch(console.error);
