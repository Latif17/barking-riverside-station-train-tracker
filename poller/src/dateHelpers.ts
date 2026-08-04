// poller/src/dateHelpers.ts
export function todayLondon(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

export function londonTimeToUtcIso(serviceDate: string, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);
  const [year, month, day] = serviceDate.split('-').map(Number);
  
  // Try offset 1 (BST) and offset 0 (GMT)
  const date1 = new Date(Date.UTC(year, month - 1, day, hour - 1, minute, 0, 0));
  const date0 = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  const formatter = new Intl.DateTimeFormat('en-GB', { 
    timeZone: 'Europe/London', 
    hour: '2-digit', 
    minute: '2-digit', 
    hourCycle: 'h23' 
  });

  if (formatter.format(date1) === hhmm) {
    return date1.toISOString();
  }
  if (formatter.format(date0) === hhmm) {
    return date0.toISOString();
  }
  
  // Fallback (e.g. for the skipped hour during spring forward)
  return date1.toISOString(); 
}

export function londonIsoToUtcIso(localIso: string): string {
  const [datePart, timePart] = localIso.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  
  const date1 = new Date(Date.UTC(year, month - 1, day, hour - 1, minute, second || 0, 0));
  const date0 = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0, 0));

  const formatter = new Intl.DateTimeFormat('en-GB', { 
    timeZone: 'Europe/London', 
    hour: '2-digit', 
    minute: '2-digit', 
    hourCycle: 'h23' 
  });

  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  
  if (formatter.format(date1) === hhmm) {
    return date1.toISOString();
  }
  if (formatter.format(date0) === hhmm) {
    return date0.toISOString();
  }
  
  return date1.toISOString(); 
}
