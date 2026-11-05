import axios, { AxiosError, AxiosHeaders, type AxiosAdapter } from 'axios';
import { createCmcClient } from '../src/cmc/client';

const quote = { id: 1, quote: [{ symbol: 'USD', price: 123, last_updated: '2026-01-01T00:00:00.000Z' }] };
function setup(adapter: AxiosAdapter, maxRetries = 0) {
  return createCmcClient({ apiKey: 'test-secret', quoteCurrency: 'USD', maxRetries, http: axios.create({ adapter }) });
}

describe('CMC client', () => {
  it('requests and validates one map page', async () => {
    const adapter: AxiosAdapter = async (config) => {
      expect(config.url).toBe('/v1/cryptocurrency/map');
      expect(config.params).toEqual({ start: 1, limit: 10, sort: 'id' });
      expect(config.headers.get('X-CMC_PRO_API_KEY')).toBe('test-secret');
      expect(config.timeout).toBe(10_000);
      return { data: { data: [{ id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin' }] }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(setup(adapter).map(1, 10)).resolves.toEqual([{ id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin' }]);
  });

  it('requests v3 quotes and converts the array response', async () => {
    const adapter: AxiosAdapter = async (config) => {
      expect(config.url).toBe('/v3/cryptocurrency/quotes/latest');
      expect(config.params).toEqual({ id: '1', convert: 'USD', skip_invalid: 'true' });
      return { data: { data: [quote], status: { error_code: 0 } }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(setup(adapter).quotesLatest([1])).resolves.toEqual({ quotes: [{ id: 1, price: 123, quoteCurrency: 'USD', sourceUpdatedAt: '2026-01-01T00:00:00.000Z' }], missingIds: [] });
  });

  it('splits more than 250 IDs into sequential requests', async () => {
    const batches: number[][] = [];
    const adapter: AxiosAdapter = async (config) => {
      const ids = (config.params.id as string).split(',').map(Number);
      batches.push(ids);
      return { data: { data: ids.map((id) => ({ ...quote, id })) }, status: 200, statusText: 'OK', headers: {}, config };
    };
    const ids = Array.from({ length: 501 }, (_, index) => index + 1);
    const result = await setup(adapter).quotesLatest(ids);
    expect(batches.map((batch) => batch.length)).toEqual([250, 250, 1]);
    expect(result.quotes.map((item) => item.id)).toEqual(ids);
    expect(result.missingIds).toEqual([]);
  });

  it('returns no partial result if a later batch fails', async () => {
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
      calls++;
      const ids = (config.params.id as string).split(',').map(Number);
      return { data: { data: calls === 1 ? ids.map((id) => ({ ...quote, id })) : {} }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(setup(adapter).quotesLatest(Array.from({ length: 251 }, (_, i) => i + 1))).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(calls).toBe(2);
  });

  it('returns valid quotes and missing IDs separately', async () => {
    const adapter: AxiosAdapter = async (config) => ({ data: { data: [quote] }, status: 200, statusText: 'OK', headers: {}, config });
    const result = await setup(adapter).quotesLatest([1, 2]);
    expect(result.quotes.map((q) => q.id)).toEqual([1]);
    expect(result.missingIds).toEqual([2]);
  });

  it.each([
    ['data is not an array', { data: {} }],
    ['unsuccessful status', { data: [quote], status: { error_code: 1001 } }],
    ['negative price', { data: [{ ...quote, quote: [{ ...quote.quote[0], price: -1 }] }] }],
    ['price is a string', { data: [{ ...quote, quote: [{ ...quote.quote[0], price: '123' }] }] }],
    ['wrong currency', { data: [{ ...quote, quote: [{ ...quote.quote[0], symbol: 'EUR' }] }] }],
    ['invalid timestamp', { data: [{ ...quote, quote: [{ ...quote.quote[0], last_updated: 'invalid' }] }] }],
    ['year only', { data: [{ ...quote, quote: [{ ...quote.quote[0], last_updated: '2026' }] }] }],
    ['non-leap day', { data: [{ ...quote, quote: [{ ...quote.quote[0], last_updated: '2026-02-29T00:00:00Z' }] }] }],
    ['invalid month day', { data: [{ ...quote, quote: [{ ...quote.quote[0], last_updated: '2024-04-31T00:00:00Z' }] }] }],
    ['missing timezone', { data: [{ ...quote, quote: [{ ...quote.quote[0], last_updated: '2024-02-29T00:00:00' }] }] }],
    ['duplicate IDs', { data: [quote, quote] }],
  ])('rejects malformed quote response: %s', async (_description, body) => {
    const adapter: AxiosAdapter = async (config) => ({ data: body, status: 200, statusText: 'OK', headers: {}, config });
    await expect(setup(adapter).quotesLatest([1])).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it.each(['2024-02-29T23:59:59Z', '2000-02-29T00:00:00.123+03:00'])('accepts valid timestamp %s', async (timestamp) => {
    const adapter: AxiosAdapter = async (config) => ({ data: { data: [{ ...quote, quote: [{ ...quote.quote[0], last_updated: timestamp }] }] }, status: 200, statusText: 'OK', headers: {}, config });
    await expect(setup(adapter).quotesLatest([1])).resolves.toMatchObject({ missingIds: [], quotes: [{ sourceUpdatedAt: timestamp }] });
  });

  it('rejects a malformed map record', async () => {
    const adapter: AxiosAdapter = async (config) => ({ data: { data: [{ id: 1, name: 'Bitcoin', symbol: 'BTC', slug: '' }] }, status: 200, statusText: 'OK', headers: {}, config });
    await expect(setup(adapter).map(1, 10)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('does not retry authentication errors or expose the key', async () => {
    const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>(async (config) => {
      throw new AxiosError('test-secret', 'ERR_BAD_REQUEST', config, undefined, { data: {}, status: 401, statusText: 'Unauthorized', headers: new AxiosHeaders(), config });
    });
    await expect(setup(adapter, 2).map(1, 1)).rejects.toMatchObject({ kind: 'authentication', message: 'CoinMarketCap authentication error (HTTP 401)' });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and stops when aborted during backoff', async () => {
    const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>(async (config) => { throw new AxiosError('network', 'ECONNRESET', config); });
    const controller = new AbortController();
    const result = setup(adapter, 2).map(1, 1, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('does not retry a daily rate limit even with Retry-After', async () => {
    const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>(async (config) => {
      throw new AxiosError('limited', 'ERR_BAD_REQUEST', config, undefined, { data: { status: { error_code: 1009 } }, status: 429, statusText: '', headers: new AxiosHeaders({ 'retry-after': '1' }), config });
    });
    await expect(setup(adapter, 2).map(1, 1)).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('classifies an exhausted timeout', async () => {
    const adapter: AxiosAdapter = async (config) => { throw new AxiosError('timeout', 'ECONNABORTED', config); };
    await expect(setup(adapter).map(1, 1)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('sanitizes unexpected transport errors', async () => {
    const adapter: AxiosAdapter = async () => { throw new Error('test-secret'); };
    await expect(setup(adapter).map(1, 1)).rejects.toMatchObject({ kind: 'internal', message: 'CoinMarketCap internal error' });
  });

  it('limits retry configuration and makes at most three retries', async () => {
    const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>(async (config) => { throw new AxiosError('network', 'ECONNRESET', config); });
    expect(() => setup(adapter, 4)).toThrow('Invalid CMC timeout or retry count');
    jest.useFakeTimers();
    try {
      const result = setup(adapter, 3).map(1, 1);
      const assertion = expect(result).rejects.toMatchObject({ kind: 'network' });
      await jest.runAllTimersAsync();
      await assertion;
      expect(adapter).toHaveBeenCalledTimes(4);
    } finally { jest.useRealTimers(); }
  });

  it('retries a temporary HTTP error', async () => {
    jest.useFakeTimers();
    try {
      const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>()
        .mockImplementationOnce(async (config) => { throw new AxiosError('unavailable', 'ERR_BAD_RESPONSE', config, undefined, { data: {}, status: 503, statusText: '', headers: new AxiosHeaders(), config }); })
        .mockImplementationOnce(async (config) => ({ data: { data: [] }, status: 200, statusText: 'OK', headers: {}, config }));
      const result = setup(adapter, 2).map(1, 10);
      await jest.advanceTimersByTimeAsync(700);
      await expect(result).resolves.toEqual([]);
      expect(adapter).toHaveBeenCalledTimes(2);
    } finally { jest.useRealTimers(); }
  });
});
