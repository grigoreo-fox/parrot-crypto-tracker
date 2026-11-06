import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCatalogRepository } from '../src/catalog/catalog-repository';
import { syncCatalog } from '../src/catalog/sync-catalog';
import { openDatabase } from '../src/database/database';

const currency = (id: number) => ({ id, name: `Name ${id}`, symbol: `S${id}`, slug: `slug-${id}` });

describe('catalog synchronization and repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-test-'));
  const db = openDatabase(join(directory, 'test.sqlite'));
  const repository = createCatalogRepository(db);
  afterEach(() => db.exec('DELETE FROM cryptocurrencies'));
  afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  it('fetches pages, saves them, and updates existing rows without deleting others', async () => {
    const source = { map: jest.fn(async (start: number) => start === 1 ? Array.from({ length: 100 }, (_, i) => currency(i + 1)) : [currency(101)]) };
    expect(await syncCatalog(source, repository)).toBe(101);
    expect(source.map.mock.calls.map(([start]) => start)).toEqual([1, 101]);
    const updated = { ...currency(1), name: 'Updated' };
    expect(await syncCatalog({ map: async () => [updated] }, repository)).toBe(1);
    expect(db.prepare('SELECT name FROM cryptocurrencies WHERE id = 1').get()).toEqual({ name: 'Updated' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM cryptocurrencies').get()).toEqual({ count: 101 });
  });

  it('reports no update time for an empty catalog and the newest time after saving', () => {
    expect(repository.latestUpdatedAt()).toBeNull();
    repository.savePage([currency(1)]);
    const first = repository.latestUpdatedAt();
    expect(first).toEqual(expect.any(String));
    repository.savePage([{ ...currency(1), name: 'Updated' }]);
    expect(Date.parse(repository.latestUpdatedAt() ?? '')).toBeGreaterThanOrEqual(Date.parse(first ?? ''));
  });

  it('rolls back an entire page when one row violates a constraint', () => {
    expect(() => repository.savePage([currency(1), { ...currency(2), name: '' }])).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM cryptocurrencies').get()).toEqual({ count: 0 });
  });

  it('keeps previously committed pages when a later request fails', async () => {
    const source = { map: jest.fn(async (start: number) => {
      if (start > 1) throw new Error('CMC unavailable');
      return Array.from({ length: 100 }, (_, i) => currency(i + 1));
    }) };
    await expect(syncCatalog(source, repository)).rejects.toThrow('CMC unavailable');
    expect(db.prepare('SELECT COUNT(*) AS count FROM cryptocurrencies').get()).toEqual({ count: 100 });
  });

  it('does not save a page when cancelled while fetching', async () => {
    const controller = new AbortController();
    const source = { map: async () => { controller.abort(); return [currency(1)]; } };
    await expect(syncCatalog(source, repository, controller.signal)).rejects.toThrow('cancelled');
    expect(db.prepare('SELECT COUNT(*) AS count FROM cryptocurrencies').get()).toEqual({ count: 0 });
  });
});
