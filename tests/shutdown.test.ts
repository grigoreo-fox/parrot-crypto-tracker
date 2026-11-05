import { createServer, type Server } from 'node:http';
import type { Logger } from '../src/logger/logger';
import { createShutdown } from '../src/shutdown';

function makeLogger(): Logger {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn() };
}

describe('shutdown', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => { process.exitCode = originalExitCode; });

  it('closes the HTTP server once even when called repeatedly', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const close = jest.spyOn(server, 'close');
    const database = { close: jest.fn(() => { expect(server.listening).toBe(false); }) };
    const shutdown = createShutdown(server, database, makeLogger());

    const first = shutdown();
    const second = shutdown();
    expect(first).toBe(second);
    await first;
    expect(close).toHaveBeenCalledTimes(1);
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
  });

  it('keeps a failure exit code when a later call reports an error', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const shutdown = createShutdown(server, { close: jest.fn() }, makeLogger());
    const stopped = shutdown();
    void shutdown(1);
    await stopped;
    expect(process.exitCode).toBe(1);
  });

  it('does not close the database when background work fails to stop within one second', async () => {
    jest.useFakeTimers();
    try {
      const logger = makeLogger();
      const database = { close: jest.fn() };
      const shutdown = createShutdown(createServer(), database, logger, () => new Promise<void>(() => {}));
      const stopped = shutdown();
      await jest.advanceTimersByTimeAsync(1000);
      await stopped;
      expect(database.close).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Background shutdown timed out');
      expect(process.exitCode).toBe(1);
    } finally { jest.useRealTimers(); }
  });

  it('reports database close errors', async () => {
    const logger = makeLogger();
    const database = { close: () => { throw new Error('database close failed'); } };
    await createShutdown(createServer(), database, logger)();
    expect(logger.error).toHaveBeenCalledWith('Failed to close database', { error: 'database close failed' });
    expect(process.exitCode).toBe(1);
  });

  it('reports a close error and sets a nonzero exit code', async () => {
    const logger = makeLogger();
    const server = {
      listening: true,
      close: (callback: (error: Error) => void) => callback(new Error('close failed')),
    } as unknown as Server;
    const database = { close: jest.fn() };
    await createShutdown(server, database, logger)();
    expect(logger.error).toHaveBeenCalledWith('Failed to stop HTTP server', { error: 'close failed' });
    expect(database.close).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
