import { catalogSyncDelayMs, createCatalogScheduler } from '../src/catalog/catalog-scheduler';
import type { Logger } from '../src/logger/logger';

const logger = (): Logger => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn() });
const currency = { id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin' };
const now = Date.parse('2026-01-02T00:00:00.000Z');

describe('catalog scheduler', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());

  it('syncs an empty catalog immediately and repeats from its update time', async () => {
    let updatedAt: string | null = null;
    const source = { map: jest.fn().mockResolvedValue([currency]) };
    const repository = { savePage: jest.fn(() => { updatedAt = new Date(Date.now()).toISOString(); }), latestUpdatedAt: () => updatedAt };
    const scheduler = createCatalogScheduler(source, repository, logger(), 1000);
    scheduler.start();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(source.map).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(999);
    expect(source.map).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(source.map).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it('does not sync an existing catalog on startup and waits for its next anchored slot', async () => {
    const source = { map: jest.fn().mockResolvedValue([currency]) };
    const repository = { savePage: jest.fn(), latestUpdatedAt: () => new Date(now - 2_500).toISOString() };
    const scheduler = createCatalogScheduler(source, repository, logger(), 10_000);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(7_499);
    expect(source.map).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(source.map).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('anchors the delay to the latest update without catching up a missed slot', () => {
    expect(catalogSyncDelayMs(null, 10_000, now)).toBe(0);
    expect(catalogSyncDelayMs('not-a-date', 10_000, now)).toBe(0);
    expect(catalogSyncDelayMs(new Date(now - 10_000).toISOString(), 10_000, now)).toBe(10_000);
    expect(catalogSyncDelayMs(new Date(now - 25_000).toISOString(), 10_000, now)).toBe(5_000);
    expect(catalogSyncDelayMs(new Date(now + 1_000).toISOString(), 10_000, now)).toBe(11_000);
  });

  it('prevents overlap and cancels in-flight work on shutdown', async () => {
    const source = { map: jest.fn((_start: number, _limit: number, signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))))) };
    const repository = { savePage: jest.fn(), latestUpdatedAt: () => null };
    const log = logger();
    const scheduler = createCatalogScheduler(source, repository, log, 1000);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(3000);
    expect(source.map).toHaveBeenCalledTimes(1);
    await scheduler.stop();
    expect(repository.savePage).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs failures without leaking details and retries after the interval', async () => {
    const source = { map: jest.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue([]) };
    const log = logger();
    const scheduler = createCatalogScheduler(source, { savePage: jest.fn(), latestUpdatedAt: () => null }, log, 1000);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith('Catalog synchronization failed', { kind: 'internal' });
    await jest.advanceTimersByTimeAsync(999);
    expect(source.map).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(source.map).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
});
