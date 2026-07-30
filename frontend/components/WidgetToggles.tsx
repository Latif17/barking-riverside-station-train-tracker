import type { WidgetVisibility } from '@/lib/dashboardConfig';

interface WidgetTogglesProps {
  visibleWidgets: WidgetVisibility;
  onChange: (next: WidgetVisibility) => void;
}

const LABELS: Record<keyof WidgetVisibility, string> = {
  statTiles: 'Stat tiles',
  peakComparison: 'Peak comparison',
  trend: 'Trend',
  recentCancellations: 'Recent cancellations',
};

export function WidgetToggles({ visibleWidgets, onChange }: WidgetTogglesProps) {
  const keys = Object.keys(LABELS) as (keyof WidgetVisibility)[];

  return (
    <fieldset className="flex flex-wrap gap-4">
      <legend className="sr-only">Visible widgets</legend>
      {keys.map((key) => (
        <label key={key} className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={visibleWidgets[key]}
            onChange={() => onChange({ ...visibleWidgets, [key]: !visibleWidgets[key] })}
          />
          {LABELS[key]}
        </label>
      ))}
    </fieldset>
  );
}
