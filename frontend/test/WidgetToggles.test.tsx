import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WidgetToggles } from '../components/WidgetToggles';
import { DEFAULT_CONFIG } from '../lib/dashboardConfig';

describe('WidgetToggles', () => {
  it('renders a checked checkbox for each visible widget', () => {
    render(<WidgetToggles visibleWidgets={DEFAULT_CONFIG.visibleWidgets} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /stat tiles/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /peak comparison/i })).toBeChecked();
  });

  it('calls onChange with the toggled widget flipped', () => {
    const onChange = vi.fn();
    render(<WidgetToggles visibleWidgets={DEFAULT_CONFIG.visibleWidgets} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /trend/i }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CONFIG.visibleWidgets, trend: false });
  });
});
