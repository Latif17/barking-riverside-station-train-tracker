import type { FailureReasonCount } from '@/lib/queries';

export function FailureReasonsChart({ reasons }: { reasons: FailureReasonCount[] }) {
  if (reasons.length === 0) {
    return <div className="text-sm text-[var(--text-secondary)]">No recorded failure reasons.</div>;
  }

  const maxCount = Math.max(...reasons.map((r) => r.count));

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-widget)] backdrop-blur-md p-4 shadow-lg">
      {reasons.slice(0, 10).map((reason) => (
        <div key={reason.reason} className="flex items-center gap-3">
          <div className="w-32 truncate text-sm text-[var(--text-primary)]" title={reason.reason}>
            {reason.reason}
          </div>
          <div className="flex-1">
            <div
              className="h-4 rounded bg-[var(--status-delayed)]"
              style={{ width: `${Math.max((reason.count / maxCount) * 100, 2)}%` }}
            />
          </div>
          <div className="w-8 text-right text-sm text-[var(--text-secondary)]">
            {reason.count}
          </div>
        </div>
      ))}
    </div>
  );
}
