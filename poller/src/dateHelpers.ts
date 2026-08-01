// poller/src/dateHelpers.ts
export function todayLondon(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
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

export function londonTimeToUtcIso(serviceDate: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);
  const offsetHours = londonUtcOffsetHoursForDate(serviceDate);
  const [year, month, day] = serviceDate.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0));
  return utc.toISOString();
}
