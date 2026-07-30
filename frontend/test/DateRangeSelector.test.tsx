import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangeSelector } from '../components/DateRangeSelector';

describe('DateRangeSelector', () => {
  it('highlights the currently-selected range', () => {
    render(<DateRangeSelector value={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the selected day count', () => {
    const onChange = vi.fn();
    render(<DateRangeSelector value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    expect(onChange).toHaveBeenCalledWith(90);
  });
});
