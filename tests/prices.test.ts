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
    expect((await get('historical?slug=ethereum')).body.data).toEqual([]);
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
