import type Database from 'better-sqlite3';
import { createApp } from './app';
import { loadConfig } from './config/config';
import { openDatabase } from './database/database';
import { createLogger } from './logger/logger';
import { createShutdown } from './shutdown';

let database: Database.Database | undefined;
try {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  database = openDatabase(config.databasePath);
  const db = database;
  const app = createApp({
    checkDatabase: () => { db.prepare('SELECT 1 FROM cryptocurrencies LIMIT 1').get(); },
  });
  const server = app.listen(config.port, () => {
    logger.info('HTTP server started', { port: config.port });
  });
  const shutdown = createShutdown(server, db, logger);

  server.on('error', (error) => {
    logger.error('HTTP server error', { error: error.message });
    void shutdown(1);
  });

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
} catch (error) {
  if (database?.open) {
    try { database.close(); } catch { /* Preserve the startup error. */ }
  }
  console.error('Failed to start application:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}
