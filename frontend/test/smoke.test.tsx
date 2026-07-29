import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from '../app/page';

describe('DashboardPage placeholder', () => {
  it('renders the site title', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Barking Riverside Train Tracker')).toBeInTheDocument();
  });
});
