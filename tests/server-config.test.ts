import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('server configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'server-config-'));
  const modulePath = resolve(__dirname, '../src/config/server-config.js');
  const read = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ['-e', `try { const c = require(${JSON.stringify(modulePath)}).loadServerConfig(); console.log(JSON.stringify({interval:c.priceSyncIntervalMs,catalogInterval:c.catalogSyncIntervalMs,currency:c.quoteCurrency})); } catch(e) { console.error(e.message); process.exitCode=1; }`], { cwd: directory, env: { ...env, NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }, encoding: 'utf8' });
  const valid = { API_BEARER_TOKEN: 'x'.repeat(32), CMC_PRO_API_KEY: 'test' };
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('defaults to five minutes and USD', () => {
    const result = read(valid);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ interval: 300000, catalogInterval: 86400000, currency: 'USD' });
  });
  it('accepts an explicit interval', () => {
    expect(JSON.parse(read({ ...valid, PRICE_SYNC_INTERVAL_MINUTES: '1234' }).stdout).interval).toBe(74040000);
  });
  it.each(['0', '-1', '1.5', '35792', ''])('rejects invalid interval %p', (value) => {
    expect(read({ ...valid, PRICE_SYNC_INTERVAL_MINUTES: value }).status).toBe(1);
  });
  it('accepts an explicit catalog interval', () => {
    expect(JSON.parse(read({ ...valid, CATALOG_SYNC_INTERVAL_MINUTES: '1234' }).stdout).catalogInterval).toBe(74040000);
  });
  it.each(['0', '-1', '1.5', '35792', ''])('rejects invalid catalog interval %p', (value) => {
    expect(read({ ...valid, CATALOG_SYNC_INTERVAL_MINUTES: value }).status).toBe(1);
  });
  it('accepts the largest supported interval for both timers', () => {
    const result = read({ ...valid, PRICE_SYNC_INTERVAL_MINUTES: '35791', CATALOG_SYNC_INTERVAL_MINUTES: '35791' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ interval: 2147460000, catalogInterval: 2147460000, currency: 'USD' });
  });
  it('requires both secrets', () => {
    expect(read({ CMC_PRO_API_KEY: 'test' }).status).toBe(1);
    expect(read({ API_BEARER_TOKEN: 'x'.repeat(32) }).status).toBe(1);
  });
});
