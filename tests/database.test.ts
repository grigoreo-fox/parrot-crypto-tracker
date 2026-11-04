import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database/database';

describe('SQLite initialization', () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'crypto-tracker-test-'));
    path = join(directory, 'test.sqlite');
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('creates the schema once and preserves data after reopening', () => {
    const db = openDatabase(path);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.prepare('INSERT INTO cryptocurrencies (id, name, symbol, slug) VALUES (?, ?, ?, ?)')
      .run(1, 'Bitcoin', 'BTC', 'bitcoin');
    db.close();

    const reopened = openDatabase(path);
    try {
      expect(reopened.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(reopened.prepare('SELECT symbol FROM cryptocurrencies WHERE id = ?').get(1))
        .toEqual({ symbol: 'BTC' });
      expect(() => reopened.prepare('INSERT INTO tracked_currencies (cryptocurrency_id) VALUES (?)')
        .run(999)).toThrow();
    } finally {
      reopened.close();
    }
  });

  it('rejects unknown schema versions without changing them', () => {
    const db = new Database(path);
    db.pragma('user_version = 2');
    db.close();
    expect(() => openDatabase(path)).toThrow('Unsupported database schema version: 2');
    const check = new Database(path);
    expect(check.pragma('user_version', { simple: true })).toBe(2);
    check.close();
  });

  it('refuses to initialize a non-empty unversioned database', () => {
    const db = new Database(path);
    db.exec('CREATE TABLE existing (id INTEGER)');
    db.close();
    expect(() => openDatabase(path)).toThrow('Cannot initialize a non-empty unversioned database');
    const check = new Database(path);
    expect(check.pragma('user_version', { simple: true })).toBe(0);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'existing'").get()).toBeDefined();
    check.close();
  });
});
