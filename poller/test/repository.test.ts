// poller/test/repository.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchPendingRows, upsertScheduledServices } from '../src/repository.js';

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

  it('upserts on the natural (service_date, direction, rtt_uid) key', async () => {
    const { client, upsert } = makeFakeClient();
    const rows = [
      {
        service_date: '2026-07-31',
        direction: 'arriving',
        scheduled_time: '2026-07-31T07:00:00.000Z',
        peak_period: undefined,
        status: 'on_time',
        observed_time: null,
        delay_minutes: null,
        rtt_uid: null,
      },
    ] as any;
    await upsertScheduledServices(client, rows);
    expect(upsert).toHaveBeenCalledWith(rows, { onConflict: 'service_date,direction,rtt_uid' });
  });

  it('throws if the upsert returns an error', async () => {
    const { client } = makeFakeClient({ upsertError: { message: 'boom' } });
    await expect(upsertScheduledServices(client, [{} as any])).rejects.toThrow(/boom/);
  });
});
