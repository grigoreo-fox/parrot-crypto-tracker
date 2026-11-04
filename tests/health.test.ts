import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { openDatabase } from '../src/database/database';

describe('GET /health', () => {
  it('returns public status when the SQLite schema can be read', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'crypto-health-test-'));
    const db = openDatabase(join(directory, 'test.sqlite'));
    try {
      const app = createApp({ checkDatabase: () => { db.prepare('SELECT 1 FROM cryptocurrencies LIMIT 1').get(); } });
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({ status: 'ok', database: 'ok' });
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns 503 without exposing database error details', async () => {
    const app = createApp({ checkDatabase: () => { throw new Error('secret database path'); } });
    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', database: 'unavailable' });
    expect(response.text).not.toContain('secret database path');
  });

  it('rejects a non-GET request', async () => {
    const response = await request(createApp({ checkDatabase: () => {} })).post('/health');
    expect(response.status).toBe(404);
  });
});
