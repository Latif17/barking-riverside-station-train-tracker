import type { RecentCancellation } from '@/lib/queries';

interface RecentCancellationsTableProps {
  rows: RecentCancellation[];
}

const DIRECTION_LABEL: Record<RecentCancellation['direction'], string> = {
  departing: 'Departing',
  arriving: 'Arriving',
};

function formatLondonDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, time };
}

export function RecentCancellationsTable({ rows }: RecentCancellationsTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">No cancellations in this date range.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
          <th className="py-1.5 pr-3 font-normal">Date</th>
          <th className="py-1.5 pr-3 font-normal">Scheduled time</th>
          <th className="py-1.5 font-normal">Direction</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { date, time } = formatLondonDateTime(row.scheduled_time);
          return (
            <tr key={`${row.service_date}-${row.scheduled_time}-${row.direction}`} className="border-b border-[var(--gridline)]">
              <td className="py-1.5 pr-3 tabular-nums text-[var(--text-primary)]">{date}</td>
              <td className="py-1.5 pr-3 tabular-nums text-[var(--text-primary)]">{time}</td>
              <td className="py-1.5 text-[var(--text-primary)]">{DIRECTION_LABEL[row.direction]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
