// poller/test/repository.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchPendingRows, upsertRows, insertSeedRows, rowsExistForDate, fetchRecentlyResolvedRows } from '../src/repository.js';

function makeFakeClient(overrides: Record<string, any> = {}) {
  const eq2 = vi.fn().mockResolvedValue({ data: overrides.selectData ?? [], error: null });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const upsert = vi.fn().mockResolvedValue({ error: overrides.upsertError ?? null });
  const insert = vi.fn().mockResolvedValue({ error: overrides.insertError ?? null });
  const from = vi.fn().mockReturnValue({ select, upsert, insert });
  return { client: { from } as any, from, select, eq1, eq2, upsert, insert };
}

describe('fetchPendingRows', () => {
  it('queries scheduled_services filtered by service_date and status', async () => {
    const { client, from, eq1, eq2 } = makeFakeClient({ selectData: [{ id: 'a' }] });
    const rows = await fetchPendingRows(client, '2026-07-29');

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(eq1).toHaveBeenCalledWith('service_date', '2026-07-29');
    expect(eq2).toHaveBeenCalledWith('status', 'pending');
    expect(rows).toEqual([{ id: 'a' }]);
  });
});

describe('upsertRows', () => {
  it('does nothing for an empty array', async () => {
    const { client, upsert } = makeFakeClient();
    await upsertRows(client, []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('calls upsert with the given rows on the conflict key', async () => {
    const { client, upsert } = makeFakeClient();
    const rows = [{ id: 'a', status: 'on_time' }] as any;
    await upsertRows(client, rows);
    expect(upsert).toHaveBeenCalledWith(rows, { onConflict: 'id' });
  });

  it('throws if the upsert returns an error', async () => {
    const { client } = makeFakeClient({ upsertError: { message: 'boom' } });
    await expect(upsertRows(client, [{ id: 'a' } as any])).rejects.toThrow(/boom/);
  });
});

describe('insertSeedRows', () => {
  it('does nothing for an empty array', async () => {
    const { client, insert } = makeFakeClient();
    await insertSeedRows(client, []);
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts the given rows', async () => {
    const { client, insert } = makeFakeClient();
    const rows = [{ service_date: '2026-07-29' }] as any;
    await insertSeedRows(client, rows);
    expect(insert).toHaveBeenCalledWith(rows);
  });

  it('throws if the insert returns an error', async () => {
    const { client } = makeFakeClient({ insertError: { message: 'dup' } });
    await expect(insertSeedRows(client, [{} as any])).rejects.toThrow(/dup/);
  });
});

describe('rowsExistForDate', () => {
  function makeFakeClientForExistence(rows: any[]) {
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { client: { from } as any, from, select, eq };
  }

  it('returns false when no rows exist for the date, regardless of status', async () => {
    const { client, from, select, eq } = makeFakeClientForExistence([]);
    const result = await rowsExistForDate(client, '2026-07-29');

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: false });
    expect(eq).toHaveBeenCalledWith('service_date', '2026-07-29');
    expect(result).toBe(false);
  });

  it('returns true when rows exist even if none are pending', async () => {
    const { client } = makeFakeClientForExistence([{ id: 'a' }]);
    const result = await rowsExistForDate(client, '2026-07-29');
    expect(result).toBe(true);
  });
});

describe('fetchRecentlyResolvedRows', () => {
  function makeFakeClientForRecentlyResolved(selectData: any[] = []) {
    const gte = vi.fn().mockResolvedValue({ data: selectData, error: null });
    const neq = vi.fn().mockReturnValue({ gte });
    const eq = vi.fn().mockReturnValue({ neq });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { client: { from } as any, from, select, eq, neq, gte };
  }

  it('queries non-pending rows for the date scheduled at or after the cutoff', async () => {
    const { client, from, eq, neq, gte } = makeFakeClientForRecentlyResolved([{ id: 'a', vehicle_id: 'veh-1' }]);
    const rows = await fetchRecentlyResolvedRows(client, '2026-07-29', '2026-07-29T06:55:00.000Z');

    expect(from).toHaveBeenCalledWith('scheduled_services');
    expect(eq).toHaveBeenCalledWith('service_date', '2026-07-29');
    expect(neq).toHaveBeenCalledWith('status', 'pending');
    expect(gte).toHaveBeenCalledWith('scheduled_time', '2026-07-29T06:55:00.000Z');
    expect(rows).toEqual([{ id: 'a', vehicle_id: 'veh-1' }]);
  });

  it('throws if the query returns an error', async () => {
    const gte = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const neq = vi.fn().mockReturnValue({ gte });
    const eq = vi.fn().mockReturnValue({ neq });
    const select = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ select }) } as any;

    await expect(fetchRecentlyResolvedRows(client, '2026-07-29', '2026-07-29T06:55:00.000Z')).rejects.toThrow(
      /boom/,
    );
  });
});
