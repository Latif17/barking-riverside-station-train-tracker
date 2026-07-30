const OPTIONS = [7, 30, 90] as const;

interface DateRangeSelectorProps {
  value: 7 | 30 | 90;
  onChange: (days: 7 | 30 | 90) => void;
}

export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  return (
    <div className="flex gap-2" role="group" aria-label="Date range">
      {OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            value === days
              ? 'border-[var(--series-trend)] bg-[var(--series-trend)] text-white'
              : 'border-[var(--gridline)] text-[var(--text-secondary)]'
          }`}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}
