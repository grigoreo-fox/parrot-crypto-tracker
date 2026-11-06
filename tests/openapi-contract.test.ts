import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import { createApp } from '../src/app';
import { createTrackingRepository } from '../src/database/tracking-repository';
import { createCatalogRepository } from '../src/catalog/catalog-repository';
import { createPriceReader } from '../src/database/price-reader';
import { openDatabase } from '../src/database/database';

const token = 'a'.repeat(32);

describe('OpenAPI response contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-contract-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  const tracking = createTrackingRepository(db);
  const api = createApp({ checkDatabase: () => {}, catalog: { apiToken: token, search: createCatalogRepository(db).search }, tracking: { apiToken: token, ...tracking }, prices: { apiToken: token, quoteCurrency: 'USD', reader: createPriceReader(db) } });
  const app = express();
  app.use(OpenApiValidator.middleware({ apiSpec: resolve(process.cwd(), 'openapi.json'), validateRequests: false, validateResponses: true }));
  app.use(api);
  beforeAll(() => {
    db.exec("INSERT INTO cryptocurrencies(id,name,symbol,slug) VALUES (1,'Bitcoin','BTC','bitcoin'),(2,'Ethereum','ETH','ethereum')");
    db.exec("INSERT INTO prices(cryptocurrency_id,price,quote_currency,fetched_at) VALUES (1,10,'USD','2026-01-01T00:00:00.000Z')");
  });
  afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('rejects a response that violates the documented schema', async () => {
    const invalid = express();
    invalid.use(OpenApiValidator.middleware({ apiSpec: resolve(process.cwd(), 'openapi.json'), validateRequests: false, validateResponses: true }));
    invalid.get('/health', (_req, res) => res.json({ status: 'wrong', database: 'ok' }));
    invalid.use(((err, _req, res, _next) => { res.status(500).json({ error: err.message }); }) as express.ErrorRequestHandler);
    const response = await request(invalid).get('/health');
    expect(response.status).toBe(500);
    expect(response.body.error).toContain('response');
  });

  it('validates health and tracked CRUD responses, including errors', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/v1/cryptocurrency/map?q=bitcoin').set(auth)).status).toBe(200);
    expect((await request(app).get('/v1/cryptocurrency/map?q=').set(auth)).status).toBe(400);
    expect((await request(app).get('/v1/cryptocurrency/map')).status).toBe(401);
    expect((await request(app).get('/v1/cryptocurrency/tracked')).status).toBe(401);
    expect((await request(app).post('/v1/cryptocurrency/tracked').set(auth).send({ id: 'bad' })).status).toBe(400);
    expect((await request(app).post('/v1/cryptocurrency/tracked').set(auth).send({ id: 999 })).status).toBe(404);
    expect((await request(app).post('/v1/cryptocurrency/tracked').set(auth).send({ id: 1 })).status).toBe(201);
    expect((await request(app).post('/v1/cryptocurrency/tracked').set(auth).send({ id: 1 })).status).toBe(409);
    expect((await request(app).get('/v1/cryptocurrency/tracked').set(auth)).status).toBe(200);
    expect((await request(app).patch('/v1/cryptocurrency/tracked?id=1').set(auth).send({ is_active: false })).status).toBe(200);
    expect((await request(app).delete('/v1/cryptocurrency/tracked?id=1').set(auth)).status).toBe(204);
  });

  it('validates latest and history responses, null prices and error bodies', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).get('/v1/cryptocurrency/prices/latest?id=1,2').set(auth)).status).toBe(200);
    expect((await request(app).get('/v1/cryptocurrency/prices/historical?id=1&count=1').set(auth)).status).toBe(200);
    expect((await request(app).get('/v1/cryptocurrency/prices/historical?id=2').set(auth)).status).toBe(200);
    expect((await request(app).get('/v1/cryptocurrency/prices/latest?id=bad').set(auth)).status).toBe(400);
    expect((await request(app).get('/v1/cryptocurrency/prices/historical?id=999').set(auth)).status).toBe(404);
    expect((await request(app).get('/v1/cryptocurrency/prices/latest?id=1')).status).toBe(401);
  });
});
