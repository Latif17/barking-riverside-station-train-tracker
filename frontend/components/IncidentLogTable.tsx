import type { Incident } from '@/lib/queries';

export function IncidentLogTable({ rows }: { rows: Incident[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-widget)] backdrop-blur-md p-4 shadow-lg">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
          <tr>
            <th className="pb-3 pr-4 font-medium">Time</th>
            <th className="pb-3 pr-4 font-medium">Direction</th>
            <th className="pb-3 pr-4 font-medium">Status</th>
            <th className="pb-3 pr-4 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {rows.map((r, i) => (
            <tr key={i} className="text-[var(--text-primary)]">
              <td className="py-3 pr-4">{new Date(r.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
              <td className="py-3 pr-4 capitalize">{r.direction}</td>
              <td className="py-3 pr-4 capitalize">
                <span className={r.status === 'cancelled' ? 'text-[var(--status-cancelled)] font-bold' : 'text-[var(--status-delayed)] font-bold'}>
                  {r.status} {r.delay_minutes ? `(+${r.delay_minutes}m)` : ''}
                </span>
              </td>
              <td className="py-3 pr-4">{r.cancel_reason || r.delay_reason || 'Unknown'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-[var(--text-secondary)]">No incidents recorded.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
