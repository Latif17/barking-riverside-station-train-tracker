// poller/test/repository.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchPendingRows, upsertScheduledServices } from '../src/repository.js';
import type { ScheduledServiceRow } from '../src/types.js';

function makeFakeClient(overrides: Record<string, any> = {}) {
  const eq2 = vi.fn().mockResolvedValue({ data: overrides.selectData ?? [], error: null });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const upsert = vi.fn().mockResolvedValue({ error: overrides.upsertError ?? null });
  const from = vi.fn().mockReturnValue({ select, upsert });
  return { client: { from } as any, from, select, eq1, eq2, upsert };
}

describe('fetchPendingRows', () => {
  it('queries scheduled_services filtered by service_date and status', async () => {
    const { client, from, eq1, eq2 } = makeFakeClient({ selectData: [{ id: 'a' }] });
    const rows = await fetchPendingRows(client, '2026-07-31');

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(eq1).toHaveBeenCalledWith('service_date', '2026-07-31');
    expect(eq2).toHaveBeenCalledWith('status', 'pending');
    expect(rows).toEqual([{ id: 'a' }]);
  });

  it('throws if the query returns an error', async () => {
    const eq2 = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const client = { from: vi.fn().mockReturnValue({ select }) } as any;

    await expect(fetchPendingRows(client, '2026-07-31')).rejects.toThrow(/boom/);
  });
});

describe('upsertScheduledServices', () => {
  it('does nothing for an empty array', async () => {
    const { client, upsert } = makeFakeClient();
    await upsertScheduledServices(client, []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts on the natural key including upstream fields', async () => {
    const { client, upsert } = makeFakeClient();
    const inputRows: ScheduledServiceRow[] = [
      {
        service_date: '2026-07-31',
        direction: 'arriving',
        scheduled_time: '2026-07-31T07:00:00.000Z',
        peak_period: 'am_peak',
        status: 'on_time',
        observed_time: null,
        delay_minutes: null,
        rtt_uid: 'W12345',
        upstream_status: 'delayed',
        upstream_observed_time: '2026-07-31T06:58:00.000Z',
        upstream_delay_minutes: 3,
      },
      {
        service_date: '2026-07-31',
        direction: 'departing',
        scheduled_time: '2026-07-31T07:15:00.000Z',
        peak_period: 'am_peak',
        status: 'pending',
        rtt_uid: 'W12346',
      },
    ];
    await upsertScheduledServices(client, inputRows);
    expect(upsert).toHaveBeenCalledWith(
      [
        {
          service_date: '2026-07-31',
          direction: 'arriving',
          scheduled_time: '2026-07-31T07:00:00.000Z',
          peak_period: 'am_peak',
          status: 'on_time',
          observed_time: null,
          delay_minutes: null,
          rtt_uid: 'W12345',
          upstream_status: 'delayed',
          upstream_observed_time: '2026-07-31T06:58:00.000Z',
          upstream_delay_minutes: 3,
        },
        {
          service_date: '2026-07-31',
          direction: 'departing',
          scheduled_time: '2026-07-31T07:15:00.000Z',
          peak_period: 'am_peak',
          status: 'pending',
          observed_time: null,
          delay_minutes: null,
          rtt_uid: 'W12346',
          upstream_status: null,
          upstream_observed_time: null,
          upstream_delay_minutes: null,
        },
      ],
      { onConflict: 'service_date,direction,scheduled_time' }
    );
  });

  it('throws if the upsert returns an error', async () => {
    const { client } = makeFakeClient({ upsertError: { message: 'boom' } });
    await expect(upsertScheduledServices(client, [{} as any])).rejects.toThrow(/boom/);
  });
});
