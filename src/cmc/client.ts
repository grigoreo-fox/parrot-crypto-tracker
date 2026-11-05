import axios, { type AxiosInstance } from 'axios';
import { setTimeout as delay } from 'node:timers/promises';

export type CmcErrorKind = 'cancelled' | 'timeout' | 'network' | 'authentication' | 'rate_limit' | 'http' | 'invalid_response' | 'internal';

export class CmcError extends Error {
  constructor(readonly kind: CmcErrorKind, readonly status?: number) {
    super(`CoinMarketCap ${kind} error${status === undefined ? '' : ` (HTTP ${status})`}`);
    this.name = 'CmcError';
  }
}

export interface CatalogCurrency { id: number; name: string; symbol: string; slug: string }
export interface LatestQuote { id: number; price: number; quoteCurrency: string; sourceUpdatedAt: string }
export interface QuotesResult { quotes: LatestQuote[]; missingIds: number[] }

interface Options {
  apiKey: string;
  quoteCurrency: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Optional transport for tests. */
  http?: AxiosInstance;
}

const MAX_IDS = 250; // Our conservative batch size, not a documented CMC limit.
const MAX_RETRY_WAIT_MS = 8_000;
const MAX_RETRIES = 3;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const invalidResponse = (): CmcError => new CmcError('invalid_response');

// RFC 3339 timestamps with an explicit offset; reject invalid calendar dates.
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, mo, d, h, mi, s, zone] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function parseData(body: unknown): unknown[] {
  if (!isObject(body) || !Array.isArray(body.data)) throw invalidResponse();
  if (body.status !== undefined) {
    if (!isObject(body.status) || (body.status.error_code !== 0 && body.status.error_code !== '0')) throw invalidResponse();
  }
  return body.data;
}

function retryAfterMs(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const time = Date.parse(text);
  return Number.isFinite(time) ? Math.max(0, time - Date.now()) : undefined;
}

export function createCmcClient(options: Options) {
  if (!options.apiKey.trim()) throw new Error('CMC API key must not be empty');
  const currency = options.quoteCurrency.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(currency)) throw new Error('Invalid quote currency');
  const timeout = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_RETRIES) {
    throw new Error('Invalid CMC timeout or retry count');
  }
  const http = options.http ?? axios.create();

  async function get(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new CmcError('cancelled');
      try {
        const response = await http.get<unknown>(path, {
          baseURL: 'https://pro-api.coinmarketcap.com', params, signal, timeout,
          headers: { 'X-CMC_PRO_API_KEY': options.apiKey, Accept: 'application/json' },
          maxRedirects: 0,
        });
        return response.data;
      } catch (error) {
        if (signal?.aborted || axios.isCancel(error)) throw new CmcError('cancelled');
        if (!axios.isAxiosError(error)) throw new CmcError('internal');
        const status = error.response?.status;
        const code = error.code;
        const kind: CmcErrorKind = status === 401 || status === 403 ? 'authentication'
          : status === 429 ? 'rate_limit'
          : status !== undefined ? 'http'
          : code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'timeout' : 'network';
        const safeError = new CmcError(kind, status);
        const cmcStatus = isObject(error.response?.data) && isObject(error.response.data.status) ? error.response.data.status : undefined;
        const cmcCode = Number(cmcStatus?.error_code);
        let wait = Math.min(500 * 2 ** attempt + Math.random() * 100, MAX_RETRY_WAIT_MS);
        let retry = kind === 'network' || kind === 'timeout' || status === 408 || (status !== undefined && status >= 500 && status <= 599);
        if (status === 429) {
          const requested = retryAfterMs(error.response?.headers?.['retry-after']);
          retry = cmcCode !== 1009 && cmcCode !== 1010 && requested !== undefined && requested <= MAX_RETRY_WAIT_MS;
          if (requested !== undefined) wait = requested;
        }
        if (!retry || attempt >= maxRetries) throw safeError;
        try { await delay(wait, undefined, { signal }); } catch { throw new CmcError('cancelled'); }
      }
    }
  }

  return {
    /** Fetch one page; the caller controls pagination and persistence. */
    async map(start: number, limit: number, signal?: AbortSignal): Promise<CatalogCurrency[]> {
      if (!validId(start) || !validId(limit)) throw new Error('Map start and limit must be positive integers');
      return parseData(await get('/v1/cryptocurrency/map', { start, limit, sort: 'id' }, signal)).map((item) => {
        if (!isObject(item) || !validId(item.id) || !validText(item.name) || !validText(item.symbol) || !validText(item.slug)) throw invalidResponse();
        return { id: item.id, name: item.name, symbol: item.symbol, slug: item.slug };
      });
    },
    /** Missing IDs are returned separately; failed requests never return partial results. */
    async quotesLatest(ids: readonly number[], signal?: AbortSignal): Promise<QuotesResult> {
      if (ids.length === 0 || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length) {
        throw new Error('Expected distinct positive CMC IDs');
      }
      const requestedIds = [...ids];
      const quotes: LatestQuote[] = [];
      const missingIds: number[] = [];
      for (let offset = 0; offset < requestedIds.length; offset += MAX_IDS) {
        const batch = requestedIds.slice(offset, offset + MAX_IDS);
        const requested = new Set(batch);
        const data = parseData(await get('/v3/cryptocurrency/quotes/latest', { id: batch.join(','), convert: currency, skip_invalid: 'true' }, signal));
        const seen = new Set<number>();
        for (const item of data) {
          if (!isObject(item) || !validId(item.id) || !requested.has(item.id) || seen.has(item.id) || !Array.isArray(item.quote)) throw invalidResponse();
          seen.add(item.id);
          const matches = item.quote.filter((q: unknown) => isObject(q) && q.symbol === currency);
          const quote = matches[0];
          if (matches.length !== 1 || !isObject(quote) || typeof quote.price !== 'number' || !Number.isFinite(quote.price) || quote.price < 0 || !validTimestamp(quote.last_updated)) throw invalidResponse();
          quotes.push({ id: item.id, price: quote.price, quoteCurrency: currency, sourceUpdatedAt: quote.last_updated });
        }
        missingIds.push(...batch.filter((id) => !seen.has(id)));
      }
      return { quotes, missingIds };
    },
  };
}
