import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { openDatabase } from '../src/database/database';
import { createPriceReader } from '../src/database/price-reader';

const token = 'a'.repeat(32);
describe('price endpoints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prices-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  const app = createApp({ checkDatabase: () => {}, prices: { apiToken: token, quoteCurrency: 'USD', reader: createPriceReader(db) } });
  const get = (path: string) => request(app).get(`/v1/cryptocurrency/prices/${path}`).set('Authorization', `Bearer ${token}`);
  beforeAll(() => {
    db.exec(`INSERT INTO cryptocurrencies (id,name,symbol,slug) VALUES (1,'Bitcoin','BTC','bitcoin'), (2,'Ethereum','ETH','ethereum');
      INSERT INTO prices (cryptocurrency_id,price,quote_currency,fetched_at) VALUES
      (1,10,'USD','2026-01-01T00:00:00.000Z'),
      (1,11,'USD','2026-01-02T00:00:00.000Z'),
      (1,12,'USD','2026-01-02T00:00:00.000Z'),
      (1,99,'EUR','2026-01-03T00:00:00.000Z')`);
  });
  afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('reads the most recent price in configured currency and null for no price', async () => {
    const response = await get('latest?id=1,2');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ id: 1, price: expect.objectContaining({ price: 12, quote_currency: 'USD' }) }),
      expect.objectContaining({ id: 2, price: null }),
    ]);
    expect((await get('latest?slug=bitcoin')).body.data[0].id).toBe(1);
  });
  it('rejects bad selection, missing assets and unauthenticated requests', async () => {
    for (const query of ['', '?id=1&slug=bitcoin', '?id=1,1', '?id=0', '?id=1,,2', '?id=1&id=2', '?slug=bitcoin%27']) {
      expect((await get(`latest${query}`)).status).toBe(400);
    }
    expect((await get('latest?id=999')).status).toBe(404);
    expect((await request(app).get('/v1/cryptocurrency/prices/latest?id=1')).status).toBe(401);
  });
  it('returns history across currencies, newest first, with inclusive time filters and count', async () => {
    const result = await get('historical?id=1&time_start=2026-01-02T00:00:00Z&time_end=2026-01-03T00:00:00Z&count=2');
    expect(result.status).toBe(200);
    expect(result.body.data.map((row: { price: number }) => row.price)).toEqual([99, 12]);
    expect(result.body.data[0].quote_currency).toBe('EUR');
    expect(result.body.meta).toEqual({ count: 2, total: 3, next_cursor: expect.any(String) });
    const empty = await get('historical?slug=ethereum');
    expect(empty.body).toEqual({ data: [], meta: { count: 100, total: 0, next_cursor: null } });
    const all = await get('historical?id=1,2&count=1');
    expect(all.body.data).toHaveLength(1);
    expect(all.body.meta).toEqual({ count: 1, total: 4, next_cursor: expect.any(String) });
  });
  it('paginates tied timestamps without duplicates even when a new price arrives', async () => {
    const first = await get('historical?id=1&count=2');
    expect(first.body.data.map((row: { price: number }) => row.price)).toEqual([99, 12]);
    const cursor = first.body.meta.next_cursor;
    db.prepare("INSERT INTO prices (cryptocurrency_id,price,quote_currency,fetched_at) VALUES (1,123,'USD','2026-01-04T00:00:00.000Z')").run();
    try {
      const second = await get(`historical?id=1&count=2&cursor=${cursor}`);
      expect(second.status).toBe(200);
      expect(second.body.data.map((row: { price: number }) => row.price)).toEqual([11, 10]);
      expect(second.body.meta).toEqual({ count: 2, total: 5, next_cursor: null });
      expect(second.body.data[0]).not.toHaveProperty('cursor_id');
      expect((await get(`historical?id=2&cursor=${cursor}`)).status).toBe(400);
      expect((await get(`historical?id=1&time_start=2026-01-01T00:00:00Z&cursor=${cursor}`)).status).toBe(400);
    } finally { db.prepare('DELETE FROM prices WHERE price = 123').run(); }
  });
  it('walks filtered history across multiple pages and currencies', async () => {
    const filter = 'id=1,2&time_start=2026-01-02T00:00:00Z&time_end=2026-01-03T00:00:00Z&count=1';
    const prices: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const response = await get(`historical?${filter}${cursor ? `&cursor=${cursor}` : ''}`);
      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(3);
      expect(response.body.data).toHaveLength(1);
      prices.push(response.body.data[0].price);
      cursor = response.body.meta.next_cursor;
      if (page < 2) expect(cursor).toEqual(expect.any(String));
    }
    expect(prices).toEqual([99, 12, 11]);
    expect(cursor).toBeNull();
  });
  it('rejects malformed and repeated cursors', async () => {
    for (const cursor of ['', '%%%25', 'abc', 'e30', 'abc&cursor=def']) {
      expect((await get(`historical?id=1&cursor=${cursor}`)).status).toBe(400);
    }
  });
  it('validates timestamps, ranges, counts and authentication', async () => {
    for (const query of ['?id=1&time_start=2026', '?id=1&time_start=2026-02-29T00:00:00Z', '?id=1&time_start=2026-02-01T00:00:00Z&time_end=2026-01-01T00:00:00Z', '?id=1&count=0', '?id=1&count=1001']) {
      expect((await get(`historical${query}`)).status).toBe(400);
    }
    expect((await get('historical?id=999')).status).toBe(404);
    expect((await request(app).get('/v1/cryptocurrency/prices/historical?id=1')).status).toBe(401);
  });
  it('reports ambiguous slugs rather than returning a different currency', async () => {
    db.prepare("INSERT INTO cryptocurrencies (id,name,symbol,slug) VALUES (3,'Other','OTH','bitcoin')").run();
    try { expect((await get('latest?slug=bitcoin')).status).toBe(409); }
    finally { db.prepare('DELETE FROM cryptocurrencies WHERE id=3').run(); }
  });
});
