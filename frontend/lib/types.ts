export type Direction = 'departing' | 'arriving';
export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';
export type ServiceStatus = 'pending' | 'early' | 'on_time' | 'delayed' | 'cancelled';

export interface ScheduledService {
  id: string;
  service_date: string;
  direction: Direction;
  scheduled_time: string;
  peak_period: PeakPeriod;
  status: ServiceStatus;
  observed_time: string | null;
  delay_minutes: number | null;
}

export interface Incident {
  service_date: string;
  scheduled_time: string;
  direction: Direction;
  status: string;
  delay_minutes: number | null;
  cancel_reason: string | null;
  delay_reason: string | null;
  upstream_delay_minutes: number | null;
}
