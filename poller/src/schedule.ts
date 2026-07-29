// poller/src/schedule.ts
import { computePeakPeriod } from './peakPeriod.js';
import type { DaySchedule, Direction, ScheduleConfig, ScheduledServiceRow } from './types.js';

function dayTypeFor(serviceDate: string): 'weekday' | 'saturday' | 'sunday' {
  // serviceDate is 'YYYY-MM-DD'; interpret as a London calendar date (no
  // time-of-day ambiguity since we only need the day of week).
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
  }).format(new Date(`${serviceDate}T12:00:00Z`));

  if (weekday === 'Sat') return 'saturday';
  if (weekday === 'Sun') return 'sunday';
  return 'weekday';
}

function londonUtcOffsetHoursForDate(serviceDate: string): number {
  // Anchor at local noon so we never straddle a day boundary or a DST
  // transition (which happen at 01:00/02:00 local, not noon).
  const noonUtcGuess = new Date(`${serviceDate}T12:00:00.000Z`);
  const londonHourAtNoon = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(noonUtcGuess),
  );
  return londonHourAtNoon - 12;
}

function londonTimeToUtcIso(serviceDate: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);
  const offsetHours = londonUtcOffsetHoursForDate(serviceDate);
  const [year, month, day] = serviceDate.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0));
  return utc.toISOString();
}

function rowsForDirection(
  serviceDate: string,
  direction: Direction,
  times: string[],
): ScheduledServiceRow[] {
  return times.map((hhmm) => {
    const scheduled_time = londonTimeToUtcIso(serviceDate, hhmm);
    return {
      service_date: serviceDate,
      direction,
      scheduled_time,
      peak_period: computePeakPeriod(new Date(scheduled_time)),
      status: 'pending' as const,
    };
  });
}

export function buildSeedRows(schedule: ScheduleConfig, serviceDate: string): ScheduledServiceRow[] {
  const dayType = dayTypeFor(serviceDate);
  const daySchedule: DaySchedule = schedule[dayType];

  return [
    ...rowsForDirection(serviceDate, 'departing', daySchedule.departing),
    ...rowsForDirection(serviceDate, 'arriving', daySchedule.arriving),
  ];
}
