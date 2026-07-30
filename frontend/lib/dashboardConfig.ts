export interface WidgetVisibility {
  statTiles: boolean;
  peakComparison: boolean;
  trend: boolean;
  recentCancellations: boolean;
}

export interface DashboardConfig {
  dateRangeDays: 7 | 30 | 90;
  visibleWidgets: WidgetVisibility;
}

export const DEFAULT_CONFIG: DashboardConfig = {
  dateRangeDays: 30,
  visibleWidgets: {
    statTiles: true,
    peakComparison: true,
    trend: true,
    recentCancellations: true,
  },
};

const STORAGE_KEY = 'barking-riverside-dashboard-config';

export function loadDashboardConfig(): DashboardConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;

    const parsed = JSON.parse(raw);
    return {
      dateRangeDays: parsed.dateRangeDays ?? DEFAULT_CONFIG.dateRangeDays,
      visibleWidgets: { ...DEFAULT_CONFIG.visibleWidgets, ...parsed.visibleWidgets },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveDashboardConfig(config: DashboardConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
