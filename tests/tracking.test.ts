import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { openDatabase } from '../src/database/database';
import { createTrackingRepository } from '../src/database/tracking-repository';

const token = 'a'.repeat(32);
describe('tracked currency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracked-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  const repository = createTrackingRepository(db);
  const app = createApp({ checkDatabase: () => {}, tracking: { apiToken: token, ...repository } });
  beforeEach(() => {
    db.exec("DELETE FROM prices; DELETE FROM tracked_currencies; DELETE FROM cryptocurrencies; INSERT INTO cryptocurrencies(id,name,symbol,slug) VALUES (1,'Bitcoin','BTC','bitcoin')");
  });
  afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('requires a valid bearer token', async () => {
    expect((await request(app).post('/v1/cryptocurrency/tracked').send({ id: 1 })).status).toBe(401);
    expect((await request(app).post('/v1/cryptocurrency/tracked').set('Authorization', 'Bearer wrong').send({ id: 1 })).status).toBe(401);
  });
  it('validates input, requires a catalog entry, and detects duplicates', async () => {
    const post = (body: object) => request(app).post('/v1/cryptocurrency/tracked').set('Authorization', `Bearer ${token}`).send(body);
    expect((await post({ id: '1' })).status).toBe(400);
    expect((await post({ id: 999 })).status).toBe(404);
    expect((await post({ id: 1 })).status).toBe(201);
    expect((await post({ id: 1 })).status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) AS count FROM prices').get()).toEqual({ count: 0 });
  });
  it('lists tracked currencies with pagination and validates parameters', async () => {
    db.exec("INSERT INTO cryptocurrencies(id,name,symbol,slug) VALUES (2,'Ethereum','ETH','ethereum')");
    repository.addTracked(1);
    repository.addTracked(2);
    const get = (query: string) => request(app).get(`/v1/cryptocurrency/tracked${query}`).set('Authorization', `Bearer ${token}`);
    const result = await get('?start=2&limit=1');
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual([expect.objectContaining({ id: 2, name: 'Ethereum', symbol: 'ETH', is_active: true, last_synced_at: null })]);
    expect((await get('?start=0')).status).toBe(400);
    expect((await get('?limit=101')).status).toBe(400);
    expect((await get('?start=1&start=2')).status).toBe(400);
    expect((await request(app).get('/v1/cryptocurrency/tracked')).status).toBe(401);
  });
  it('pauses and resumes tracking and rejects invalid or missing records', async () => {
    repository.addTracked(1);
    const patch = (id: string, body: object) => request(app).patch(`/v1/cryptocurrency/tracked?id=${id}`).set('Authorization', `Bearer ${token}`).send(body);
    expect((await patch('1', { is_active: false })).body).toEqual({ data: { id: 1, is_active: false } });
    expect(repository.activeIds()).toEqual([]);
    expect((await patch('1', { is_active: true })).status).toBe(200);
    expect(repository.activeIds()).toEqual([1]);
    expect((await patch('1', { is_active: 'false' })).status).toBe(400);
    expect((await patch('x', { is_active: false })).status).toBe(400);
    expect((await patch('2', { is_active: false })).status).toBe(404);
    expect((await request(app).patch('/v1/cryptocurrency/tracked?id=1').send({ is_active: false })).status).toBe(401);
  });
  it('deletes tracking but preserves price history and permits adding again', async () => {
    repository.addTracked(1);
    repository.savePrices([{ id: 1, price: 3, quoteCurrency: 'USD', sourceUpdatedAt: '2026-01-01T00:00:00Z' }]);
    const del = (id: string) => request(app).delete(`/v1/cryptocurrency/tracked?id=${id}`).set('Authorization', `Bearer ${token}`);
    expect((await del('1')).status).toBe(204);
    expect((await del('1')).status).toBe(404);
    expect((await del('bad')).status).toBe(400);
    expect((await request(app).delete('/v1/cryptocurrency/tracked?id=1')).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS count FROM prices').get()).toEqual({ count: 1 });
    expect(repository.addTracked(1)).toBe('created');
  });
  it('inserts prices and sync time atomically, skipping no-longer-active IDs', () => {
    repository.addTracked(1);
    const quote = { id: 1, price: 3, quoteCurrency: 'USD', sourceUpdatedAt: '2026-01-01T00:00:00Z' };
    expect(repository.savePrices([quote])).toBe(1);
    expect(db.prepare('SELECT price, quote_currency FROM prices').get()).toEqual({ price: 3, quote_currency: 'USD' });
    expect(db.prepare('SELECT last_synced_at FROM tracked_currencies').get()).toEqual({ last_synced_at: expect.any(String) });
    db.prepare('UPDATE tracked_currencies SET is_active = 0').run();
    expect(repository.savePrices([quote])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM prices').get()).toEqual({ count: 1 });
  });
  it('rolls back all price inserts on an invalid quote', () => {
    repository.addTracked(1);
    const quote = { id: 1, price: 1, quoteCurrency: 'USD', sourceUpdatedAt: '2026-01-01T00:00:00Z' };
    expect(() => repository.savePrices([quote, { ...quote, price: -1 }])).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM prices').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT last_synced_at FROM tracked_currencies').get()).toEqual({ last_synced_at: null });
  });
});
