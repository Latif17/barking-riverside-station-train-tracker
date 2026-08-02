import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ScheduledServiceRow, Direction } from './types.js';
import { computePeakPeriod } from './peakPeriod.js';
import { londonTimeToUtcIso } from './dateHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ScheduleData {
  weekday: { departing: string[]; arriving: string[] };
  saturday: { departing: string[]; arriving: string[] };
  sunday: { departing: string[]; arriving: string[] };
}

let cachedSchedule: ScheduleData | null = null;

function loadSchedule(): ScheduleData {
  if (!cachedSchedule) {
    const raw = readFileSync(join(__dirname, '../schedule.json'), 'utf-8');
    cachedSchedule = JSON.parse(raw) as ScheduleData;
  }
  return cachedSchedule;
}

export function getScheduledServicesForDate(serviceDate: string): ScheduledServiceRow[] {
  const schedule = loadSchedule();
  const date = new Date(serviceDate);
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday

  let dayKey: 'weekday' | 'saturday' | 'sunday' = 'weekday';
  if (day === 0) dayKey = 'sunday';
  if (day === 6) dayKey = 'saturday';

  const daySchedule = schedule[dayKey];
  const rows: ScheduledServiceRow[] = [];

  for (const direction of ['departing', 'arriving'] as Direction[]) {
    for (const timeStr of daySchedule[direction]) {
      const scheduled_time = londonTimeToUtcIso(serviceDate, timeStr);
      rows.push({
        service_date: serviceDate,
        direction,
        scheduled_time,
        peak_period: computePeakPeriod(new Date(scheduled_time)),
        status: 'pending',
        observed_time: null,
        delay_minutes: 0,
        rtt_uid: null,
      });
    }
  }

  return rows;
}
