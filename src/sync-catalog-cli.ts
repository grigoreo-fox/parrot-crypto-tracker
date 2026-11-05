import { createCatalogRepository } from './catalog/catalog-repository';
import { syncCatalog } from './catalog/sync-catalog';
import { createCmcClient } from './cmc/client';
import { loadConfig } from './config/config';
import { openDatabase } from './database/database';
import { createLogger } from './logger/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const apiKey = process.env.CMC_PRO_API_KEY;
  if (!apiKey?.trim()) throw new Error('CMC_PRO_API_KEY must not be empty');

  const controller = new AbortController();
  const onInterrupt = () => { process.exitCode = 130; controller.abort(); };
  const onTerminate = () => { process.exitCode = 143; controller.abort(); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const database = openDatabase(config.databasePath);
    try {
      const client = createCmcClient({ apiKey, quoteCurrency: 'USD' });
      const repository = createCatalogRepository(database);
      logger.info('Catalog synchronization started');
      const count = await syncCatalog(client, repository, controller.signal);
      logger.info('Catalog synchronization completed', { count });
    } finally {
      database.close();
    }
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

void main().catch((error: unknown) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error('Catalog synchronization failed:', error instanceof Error ? error.message : 'unknown error');
});
