import type { Server } from 'node:http';
import type { Logger } from './logger/logger';

interface CloseableDatabase {
  close(): void;
}

/** Stops HTTP before closing the database; repeated calls share the same shutdown. */
export function createShutdown(server: Server, database: CloseableDatabase, logger: Logger, stopBackground?: () => Promise<void>): (exitCode?: number) => Promise<void> {
  let stopping: Promise<void> | undefined;

  return (exitCode = 0) => {
    if (exitCode !== 0) process.exitCode = exitCode;
    if (stopping) return stopping;

    logger.info('Shutting down HTTP server');
    const background = stopBackground ? (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const stopped = Promise.resolve().then(stopBackground).then(() => true);
        const deadline = new Promise<false>((resolve) => { timeout = setTimeout(() => resolve(false), 1000); });
        const complete = await Promise.race([stopped, deadline]);
        if (!complete) { logger.error('Background shutdown timed out'); process.exitCode = 1; }
        return complete;
      } catch {
        logger.error('Background shutdown failed');
        process.exitCode = 1;
        return false;
      } finally { if (timeout) clearTimeout(timeout); }
    })() : Promise.resolve(true);
    const http = new Promise<boolean>((resolve) => {
      if (!server.listening) {
        resolve(true);
        return;
      }
      server.close((error) => {
        if (error) {
          logger.error('Failed to stop HTTP server', { error: error.message });
          process.exitCode = 1;
          resolve(false);
        } else {
          logger.info('HTTP server stopped');
          resolve(true);
        }
      });
    });
    stopping = Promise.all([http, background]).then(([httpStopped, backgroundStopped]) => {
      // Do not close the database while HTTP requests or background tasks may use it.
      if (!httpStopped || !backgroundStopped) return;
      try {
        database.close();
        logger.info('Database closed');
      } catch (error) {
        logger.error('Failed to close database', { error: error instanceof Error ? error.message : 'unknown error' });
        process.exitCode = 1;
      }
    });
    return stopping;
  };
}
