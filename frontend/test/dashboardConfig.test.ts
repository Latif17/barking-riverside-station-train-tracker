import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_CONFIG, loadDashboardConfig, saveDashboardConfig } from '../lib/dashboardConfig';

describe('dashboardConfig', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the default config when nothing is stored', () => {
    expect(loadDashboardConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a saved config', () => {
    const config = {
      dateRangeDays: 90 as const,
      visibleWidgets: { statTiles: true, peakComparison: false, trend: true, recentCancellations: false },
    };
    saveDashboardConfig(config);
    expect(loadDashboardConfig()).toEqual(config);
  });

  it('falls back to defaults for missing widget keys (e.g. after adding a new widget)', () => {
    window.localStorage.setItem(
      'barking-riverside-dashboard-config',
      JSON.stringify({ dateRangeDays: 7, visibleWidgets: { statTiles: false } }),
    );
    const loaded = loadDashboardConfig();
    expect(loaded.dateRangeDays).toBe(7);
    expect(loaded.visibleWidgets.statTiles).toBe(false);
    expect(loaded.visibleWidgets.peakComparison).toBe(true); // defaulted
    expect(loaded.visibleWidgets.trend).toBe(true); // defaulted
  });

  it('falls back to defaults on corrupt stored JSON', () => {
    window.localStorage.setItem('barking-riverside-dashboard-config', '{not valid json');
    expect(loadDashboardConfig()).toEqual(DEFAULT_CONFIG);
  });
});
