import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_VERSION = 1;

/** Opens the database, enables foreign keys and initializes a new schema atomically. */
export function openDatabase(path: string): Database.Database {
  const database = new Database(path);

  try {
    database.pragma('foreign_keys = ON');

    database.transaction(() => {
      const version = database.pragma('user_version', { simple: true }) as number;
      if (version === SCHEMA_VERSION) return;
      if (version !== 0) throw new Error(`Unsupported database schema version: ${version}`);

      const existing = database.prepare(
        "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1",
      ).get();
      if (existing) throw new Error('Cannot initialize a non-empty unversioned database');

      const schemaPath = join(__dirname, 'migrations', '001-initial.sql');
      database.exec(readFileSync(schemaPath, 'utf8'));
      database.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
