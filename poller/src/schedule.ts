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

function londonTimeToUtcIso(serviceDate: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);

  // Find the UTC instant whose Europe/London wall-clock time matches
  // serviceDate + hh:mm, by starting from a UTC guess and correcting for
  // the actual London offset at that date (handles BST/GMT correctly).
  const naiveUtcGuess = new Date(`${serviceDate}T${hhmm}:00.000Z`);
  const londonPartsAtGuess = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(naiveUtcGuess);
  const londonHourAtGuess = Number(londonPartsAtGuess);
  const offsetHours = londonHourAtGuess - hour;

  const corrected = new Date(naiveUtcGuess.getTime() - offsetHours * 60 * 60 * 1000);
  return corrected.toISOString();
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
