import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('server configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'server-config-'));
  const modulePath = resolve(__dirname, '../src/config/server-config.js');
  const read = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ['-e', `try { const c = require(${JSON.stringify(modulePath)}).loadServerConfig(); console.log(JSON.stringify({interval:c.priceSyncIntervalMs,currency:c.quoteCurrency})); } catch(e) { console.error(e.message); process.exitCode=1; }`], { cwd: directory, env, encoding: 'utf8' });
  const valid = { API_BEARER_TOKEN: 'x'.repeat(32), CMC_PRO_API_KEY: 'test' };
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('defaults to five minutes and USD', () => {
    const result = read(valid);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ interval: 300000, currency: 'USD' });
  });
  it('accepts an explicit interval', () => {
    expect(JSON.parse(read({ ...valid, PRICE_SYNC_INTERVAL_MS: '1234' }).stdout).interval).toBe(1234);
  });
  it.each(['0', '-1', '1.5', '2147483648', ''])('rejects invalid interval %p', (value) => {
    expect(read({ ...valid, PRICE_SYNC_INTERVAL_MS: value }).status).toBe(1);
  });
  it('requires both secrets', () => {
    expect(read({ CMC_PRO_API_KEY: 'test' }).status).toBe(1);
    expect(read({ API_BEARER_TOKEN: 'x'.repeat(32) }).status).toBe(1);
  });
});
