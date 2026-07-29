// poller/src/types.ts

export type Direction = 'departing' | 'arriving';
export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';
export type ServiceStatus = 'pending' | 'on_time' | 'delayed' | 'cancelled';

export interface DaySchedule {
  departing: string[]; // "HH:MM" in London local time
  arriving: string[];
}

export interface ScheduleConfig {
  effective_from: string;
  weekday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

export interface ScheduledServiceRow {
  id?: string;
  service_date: string;
  direction: Direction;
  scheduled_time: string;
  peak_period: PeakPeriod;
  status: ServiceStatus;
  observed_time?: string | null;
  delay_minutes?: number | null;
  vehicle_id?: string | null;
  last_seen_time_to_station?: number | null;
  last_seen_at?: string | null;
}
