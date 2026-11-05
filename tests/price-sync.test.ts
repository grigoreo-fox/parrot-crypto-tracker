import { createPriceSync } from '../src/prices/price-sync';
import type { Logger } from '../src/logger/logger';

const logger = (): Logger => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn() });
describe('price synchronization', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('starts immediately, then repeats at the configured interval', async () => {
    const source = { quotesLatest: jest.fn().mockResolvedValue({ quotes: [], missingIds: [1] }) };
    const store = { activeIds: () => [1], savePrices: jest.fn().mockReturnValue(0) };
    const log = logger();
    const sync = createPriceSync(source, store, log, 5000);
    sync.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(source.quotesLatest).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), { ids: [1] });
    await jest.advanceTimersByTimeAsync(5000);
    expect(source.quotesLatest).toHaveBeenCalledTimes(2);
    await sync.stop();
    await jest.advanceTimersByTimeAsync(10000);
    expect(source.quotesLatest).toHaveBeenCalledTimes(2);
  });
  it('does not call CMC for an empty list', async () => {
    const source = { quotesLatest: jest.fn() };
    const sync = createPriceSync(source, { activeIds: () => [], savePrices: jest.fn() }, logger(), 1000);
    sync.start();
    await jest.advanceTimersByTimeAsync(1000);
    expect(source.quotesLatest).not.toHaveBeenCalled();
    await sync.stop();
  });
  it('prevents overlapping runs and aborts active work on stop', async () => {
    const source = { quotesLatest: jest.fn((_ids: readonly number[], signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))))) };
    const savePrices = jest.fn();
    const sync = createPriceSync(source, { activeIds: () => [1], savePrices }, logger(), 1000);
    sync.start();
    await jest.advanceTimersByTimeAsync(5000);
    expect(source.quotesLatest).toHaveBeenCalledTimes(1);
    await sync.stop();
    expect(savePrices).not.toHaveBeenCalled();
  });
  it('logs an error and allows the next scheduled run', async () => {
    const source = { quotesLatest: jest.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue({ quotes: [], missingIds: [] }) };
    const log = logger();
    const sync = createPriceSync(source, { activeIds: () => [1], savePrices: () => 0 }, log, 1000);
    sync.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith('Price synchronization failed', { kind: 'internal' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(source.quotesLatest).toHaveBeenCalledTimes(2);
    await sync.stop();
  });
});
