import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { createCatalogRepository } from '../src/catalog/catalog-repository';
import { openDatabase } from '../src/database/database';

const token = 'a'.repeat(32);
describe('catalog endpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-route-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  const catalog = createCatalogRepository(db);
  const app = createApp({ checkDatabase: () => {}, catalog: { apiToken: token, search: catalog.search } });
  const get = (query = '') => request(app).get(`/v1/cryptocurrency/map${query}`).set('Authorization', `Bearer ${token}`);
  beforeAll(() => catalog.savePage([
    { id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin' },
    { id: 2, name: 'Bitcoin Cash', symbol: 'BCH', slug: 'bitcoin-cash' },
    { id: 3, name: 'Ethereum', symbol: 'ETH', slug: 'ethereum' },
    { id: 4, name: 'Percent% Coin', symbol: 'P_C', slug: 'percent-coin' },
  ]));
  afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  it('lists currencies with pagination and a total', async () => {
    const res = await get('?start=2&limit=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 2, name: 'Bitcoin Cash', symbol: 'BCH', slug: 'bitcoin-cash' }], pagination: { start: 2, limit: 1, total: 4 } });
    expect((await get('?start=9')).body.pagination.total).toBe(4);
  });
  it('searches name, symbol and slug case-insensitively with literal wildcards', async () => {
    expect((await get('?q=BITCOIN&limit=1')).body.pagination.total).toBe(2);
    expect((await get('?q=bTc')).body.data[0].id).toBe(1);
    expect((await get('?q=coin-cash')).body.data[0].id).toBe(2);
    expect((await get('?q=%25')).body.data.map((row: { id: number }) => row.id)).toEqual([4]);
    expect((await get('?q=_')).body.data.map((row: { id: number }) => row.id)).toEqual([4]);
    expect((await get('?q=missing')).body).toEqual({ data: [], pagination: { start: 1, limit: 100, total: 0 } });
  });
  it('requires auth and validates query and pagination', async () => {
    expect((await request(app).get('/v1/cryptocurrency/map')).status).toBe(401);
    for (const query of ['?q=', '?q=%20', '?q=a&q=b', `?q=${'a'.repeat(101)}`, '?start=0', '?limit=101', '?start=1&start=2']) {
      expect((await get(query)).status).toBe(400);
    }
  });
});
