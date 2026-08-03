// poller/src/types.ts

import type { PeakPeriod } from './peakPeriod.js';
export type { PeakPeriod };
export type Direction = 'departing' | 'arriving';
export type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled';

export interface ScheduledServiceRow {
  id?: string;
  service_date: string;
  direction: Direction;
  scheduled_time: string;
  peak_period: PeakPeriod;
  status: ServiceStatus;
  observed_time?: string | null;
  delay_minutes?: number | null;
  rtt_uid: string | null;
  upstream_status?: ServiceStatus | null;
  upstream_observed_time?: string | null;
  upstream_delay_minutes?: number | null;
}
