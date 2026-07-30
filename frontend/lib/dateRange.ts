export interface DateRange {
  from: string;
  to: string;
}

const LONDON_TZ = 'Europe/London';

function londonDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON_TZ }).format(date);
}

export function computeDateRange(days: number, now: Date = new Date()): DateRange {
  const to = londonDateString(now);
  const fromInstant = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const from = londonDateString(fromInstant);
  return { from, to };
}
