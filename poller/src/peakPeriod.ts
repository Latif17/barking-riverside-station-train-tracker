
export type PeakPeriod = 'am_peak' | 'pm_peak' | 'off_peak';

const LONDON_TZ = 'Europe/London';
const SLEEP_START_MIN = 1 * 60;    // 01:00
const SLEEP_END_MIN = 5 * 60;      // 05:00
const AM_START_MIN = 6 * 60 + 30;  // 06:30
const AM_END_MIN = 9 * 60 + 30;    // 09:30
const PM_START_MIN = 16 * 60;      // 16:00
const PM_END_MIN = 19 * 60;        // 19:00
const WEEKEND_DAYS = new Set(['Sat', 'Sun']);

export function computePeakPeriod(date: Date): PeakPeriod {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')!.value;
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  const minute = Number(parts.find((p) => p.type === 'minute')!.value);
  const minutesSinceMidnight = hour * 60 + minute;

  if (WEEKEND_DAYS.has(weekday)) {
    return 'off_peak';
  }

  if (minutesSinceMidnight >= AM_START_MIN && minutesSinceMidnight < AM_END_MIN) {
    return 'am_peak';
  }

  if (minutesSinceMidnight >= PM_START_MIN && minutesSinceMidnight < PM_END_MIN) {
    return 'pm_peak';
  }

  return 'off_peak';
}

export function getPollingState(date: Date): PeakPeriod | 'sleep' {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  const minute = Number(parts.find((p) => p.type === 'minute')!.value);
  const minutesSinceMidnight = hour * 60 + minute;

  if (minutesSinceMidnight >= SLEEP_START_MIN && minutesSinceMidnight < SLEEP_END_MIN) {
    return 'sleep';
  }

  return computePeakPeriod(date);
}
