import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IncidentLogTable } from '../components/IncidentLogTable';
import type { Incident } from '../lib/queries';

const sampleIncidents: Incident[] = [
  {
    service_date: '2026-07-05',
    scheduled_time: '2026-07-05T07:03:00Z',
    direction: 'departing',
    status: 'cancelled',
    delay_minutes: null,
    cancel_reason: 'Signal failure',
    delay_reason: null,
    upstream_delay_minutes: null,
  },
  {
    service_date: '2026-07-04',
    scheduled_time: '2026-07-04T18:15:00Z',
    direction: 'arriving',
    status: 'delayed',
    delay_minutes: 15,
    cancel_reason: null,
    delay_reason: 'Train fault',
    upstream_delay_minutes: 10,
  },
];

describe('IncidentLogTable', () => {
  it('renders table headers and rows for incidents with status and reason', () => {
    render(<IncidentLogTable rows={sampleIncidents} />);
    expect(screen.getAllByRole('row')).toHaveLength(sampleIncidents.length + 1); // header + 2 data rows
    expect(screen.getByText(/departing/i)).toBeInTheDocument();
    expect(screen.getByText(/arriving/i)).toBeInTheDocument();
    expect(screen.getByText('Signal failure')).toBeInTheDocument();
    expect(screen.getByText('Train fault')).toBeInTheDocument();
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.getByText(/delayed \(\+15m\)/i)).toBeInTheDocument();
  });

  it('renders "No incidents recorded." when rows array is empty', () => {
    render(<IncidentLogTable rows={[]} />);
    expect(screen.getByText('No incidents recorded.')).toBeInTheDocument();
  });
});
