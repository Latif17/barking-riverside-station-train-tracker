// poller/src/dateHelpers.ts
export function todayLondon(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

// A service scheduled in the last ~30 minutes before midnight London time can
// have its cancellation-sweep or force-resolve deadline (poller/src/pollCycle.ts)
// fall after midnight. Once todayLondon() rolls over, that row would never be
// fetched again unless we also keep checking yesterday's service_date for a
// window after midnight. runPollCycle resolves/cancels rows purely by
// comparing each row's own scheduled_time to `now`, so mixing rows from two
// service_dates into a single call is safe.
export function yesterdayLondon(): string {
  const [year, month, day] = todayLondon().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
