import { createCatalogScheduler } from '../src/catalog/catalog-scheduler';
import type { Logger } from '../src/logger/logger';

const logger = (): Logger => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn() });
const currency = { id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin' };

describe('catalog scheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs at startup and at the configured interval, then stops', async () => {
    const source = { map: jest.fn().mockResolvedValue([currency]) };
    const repository = { savePage: jest.fn() };
    const log = logger();
    const scheduler = createCatalogScheduler(source, repository, log, 1000);
    scheduler.start();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(source.map).toHaveBeenCalledTimes(1);
    expect(repository.savePage).toHaveBeenCalledWith([currency]);
    expect(log.info).toHaveBeenCalledWith('Catalog synchronization completed', { count: 1 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(source.map).toHaveBeenCalledTimes(2);
    await scheduler.stop();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(2000);
    expect(source.map).toHaveBeenCalledTimes(2);
  });

  it('prevents overlap and cancels in-flight work on shutdown', async () => {
    const source = { map: jest.fn((_start: number, _limit: number, signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))))) };
    const repository = { savePage: jest.fn() };
    const log = logger();
    const scheduler = createCatalogScheduler(source, repository, log, 1000);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(3000);
    expect(source.map).toHaveBeenCalledTimes(1);
    await scheduler.stop();
    expect(repository.savePage).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs failures without leaking details and retries on schedule', async () => {
    const source = { map: jest.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue([]) };
    const log = logger();
    const scheduler = createCatalogScheduler(source, { savePage: jest.fn() }, log, 1000);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith('Catalog synchronization failed', { kind: 'internal' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(source.map).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
});
