import { Router, type Request } from 'express';
import type { PriceCurrency, PriceReader } from '../database/price-reader';
import { bearerAuth } from '../auth';
import { decodeHistoryCursor } from './history-cursor';

const MAX_CURRENCIES = 100;

function parseCurrencies(query: Request['query']): { type: 'id'; values: number[] } | { type: 'slug'; values: string[] } | undefined {
  const id = query.id;
  const slug = query.slug;
  if ((id === undefined) === (slug === undefined)) return undefined;
  const raw = id ?? slug;
  if (typeof raw !== 'string') return undefined;
  const parts = raw.split(',');
  if (!parts.length || parts.length > MAX_CURRENCIES || new Set(parts).size !== parts.length) return undefined;
  if (id !== undefined) {
    if (parts.some((part) => !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)))) return undefined;
    return { type: 'id', values: parts.map(Number) };
  }
  if (parts.some((part) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) return undefined;
  return { type: 'slug', values: parts };
}

/** Accept an ISO timestamp in UTC, with optional milliseconds, without normalizing invalid dates. */
function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return undefined;
  const normalized = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) && date.toISOString() === normalized ? normalized : undefined;
}

export function createPriceRouter(reader: PriceReader, token: string, quoteCurrency: string): Router {
  const router = Router();
  router.use(bearerAuth(token));

  function resolve(query: Request['query']): { currencies: PriceCurrency[] } | { status: number; error: string } {
    const selection = parseCurrencies(query);
    if (!selection) return { status: 400, error: 'Provide 1 to 100 distinct IDs or slugs' };
    const currencies: PriceCurrency[] = [];
    if (selection.type === 'id') {
      for (const id of selection.values) {
        const currency = reader.findById(id);
        if (!currency) return { status: 404, error: 'Currency not found' };
        currencies.push(currency);
      }
    } else {
      for (const slug of selection.values) {
        const matches = reader.findBySlug(slug);
        if (matches.length === 0) return { status: 404, error: 'Currency not found' };
        if (matches.length > 1) return { status: 409, error: 'Ambiguous currency slug; use ID' };
        currencies.push(matches[0]);
      }
    }
    return { currencies };
  }

  router.get('/latest', (request, response) => {
    const selected = resolve(request.query);
    if ('error' in selected) { response.status(selected.status).json({ error: selected.error }); return; }
    response.json({ data: selected.currencies.map((currency) => ({ ...currency, price: reader.latest(currency.id, quoteCurrency) })) });
  });

  router.get('/historical', (request, response) => {
    const selected = resolve(request.query);
    if ('error' in selected) { response.status(selected.status).json({ error: selected.error }); return; }
    const start = request.query.time_start === undefined ? null : parseTimestamp(request.query.time_start);
    const end = request.query.time_end === undefined ? null : parseTimestamp(request.query.time_end);
    const countText = request.query.count ?? '100';
    const count = typeof countText === 'string' && /^[1-9]\d*$/.test(countText) ? Number(countText) : NaN;
    if (start === undefined || end === undefined || (start !== null && end !== null && start > end) || !Number.isSafeInteger(count) || count < 1 || count > 1000) {
      response.status(400).json({ error: 'Invalid time range or count (1 to 1000)' });
      return;
    }
    const ids = selected.currencies.map((currency) => currency.id);
    const cursor = request.query.cursor === undefined ? null : decodeHistoryCursor(request.query.cursor, { ids, start, end });
    if (cursor === undefined) {
      response.status(400).json({ error: 'Invalid cursor or cursor does not match filters' });
      return;
    }
    response.json(reader.history(ids, start, end, count, cursor));
  });
  return router;
}
