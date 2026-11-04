import type { Server } from 'node:http';
import type { Logger } from './logger/logger';

interface CloseableDatabase {
  close(): void;
}

/** Stops HTTP before closing the database; repeated calls share the same shutdown. */
export function createShutdown(server: Server, database: CloseableDatabase, logger: Logger): (exitCode?: number) => Promise<void> {
  let stopping: Promise<void> | undefined;

  return (exitCode = 0) => {
    if (exitCode !== 0) process.exitCode = exitCode;
    if (stopping) return stopping;

    logger.info('Shutting down HTTP server');
    stopping = new Promise<boolean>((resolve) => {
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
    }).then((httpStopped) => {
      // Do not close the database while HTTP requests may still be using it.
      if (!httpStopped) return;
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
