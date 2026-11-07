import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readConfig } from '../src/config/config';

describe('application configuration', () => {
  it('uses defaults when settings are absent', () => {
    expect(readConfig({})).toEqual({ port: 3000, databasePath: './data.sqlite', logLevel: 'info' });
  });

  it('parses provided settings', () => {
    expect(readConfig({ PORT: '8080', DATABASE_PATH: './test.sqlite', LOG_LEVEL: 'debug' }))
      .toEqual({ port: 8080, databasePath: './test.sqlite', logLevel: 'debug' });
  });

  it.each(['', '0', '65536', '-1', '1.5', 'abc'])('rejects invalid PORT %p', (port) => {
    expect(() => readConfig({ PORT: port })).toThrow('PORT');
  });

  it('rejects an empty database path', () => {
    expect(() => readConfig({ DATABASE_PATH: '  ' })).toThrow('DATABASE_PATH');
  });

  it('rejects an unknown log level', () => {
    expect(() => readConfig({ LOG_LEVEL: 'verbose' })).toThrow('LOG_LEVEL');
  });

  it('loads .env without overriding existing environment variables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'crypto-config-test-'));
    try {
      writeFileSync(join(directory, '.env'), 'PORT=4000\nLOG_LEVEL=debug\n');
      const modulePath = resolve(__dirname, '../src/config/config.js');
      const result = spawnSync(process.execPath, ['-e',
        `console.log(JSON.stringify(require(${JSON.stringify(modulePath)}).loadConfig()))`,
      ], { cwd: directory, env: { PORT: '5000', NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }, encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        port: 5000, databasePath: './data.sqlite', logLevel: 'debug',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
