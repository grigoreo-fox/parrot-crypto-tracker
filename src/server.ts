import type Database from 'better-sqlite3';
import { createApp } from './app';
import { createCatalogRepository } from './catalog/catalog-repository';
import { createCatalogScheduler } from './catalog/catalog-scheduler';
import { createCmcClient } from './cmc/client';
import { loadServerConfig } from './config/server-config';
import { openDatabase } from './database/database';
import { createTrackingRepository } from './database/tracking-repository';
import { createPriceReader } from './database/price-reader';
import { createLogger } from './logger/logger';
import { createPriceSync } from './prices/price-sync';
import { createShutdown } from './shutdown';

let database: Database.Database | undefined;
try {
  const config = loadServerConfig();
  const logger = createLogger(config.logLevel);
  database = openDatabase(config.databasePath);
  const db = database;
  const healthQuery = db.prepare('SELECT 1 FROM cryptocurrencies LIMIT 1');
  const tracking = createTrackingRepository(db);
  const cmc = createCmcClient({ apiKey: config.cmcApiKey, quoteCurrency: config.quoteCurrency });
  const priceSync = createPriceSync(cmc, tracking, logger, config.priceSyncIntervalMs);
  const catalogSync = createCatalogScheduler(cmc, createCatalogRepository(db), logger, config.catalogSyncIntervalMs);
  const app = createApp({
    checkDatabase: () => { healthQuery.get(); },
    tracking: { apiToken: config.apiToken, ...tracking },
    prices: { apiToken: config.apiToken, quoteCurrency: config.quoteCurrency, reader: createPriceReader(db) },
  });
  const server = app.listen(config.port, () => {
    logger.info('HTTP server started', { port: config.port });
    catalogSync.start();
    priceSync.start();
  });
  const shutdown = createShutdown(server, db, logger, async () => {
    await Promise.all([priceSync.stop(), catalogSync.stop()]);
  });
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
