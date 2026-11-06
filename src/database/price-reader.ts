import type Database from 'better-sqlite3';
import { encodeHistoryCursor, type HistoryPosition } from '../prices/history-cursor';

export interface PriceCurrency { id: number; name: string; symbol: string; slug: string }
export interface PriceRecord { cryptocurrency_id: number; price: number; quote_currency: string; fetched_at: string; source_updated_at: string | null }

/** Read-only queries; price history remains available after tracking is removed. */
export function createPriceReader(db: Database.Database) {
  const byId = db.prepare('SELECT id, name, symbol, slug FROM cryptocurrencies WHERE id = ?');
  const bySlug = db.prepare('SELECT id, name, symbol, slug FROM cryptocurrencies WHERE slug = ? LIMIT 2');
  const latest = db.prepare(`SELECT cryptocurrency_id, price, quote_currency, fetched_at, source_updated_at
    FROM prices WHERE cryptocurrency_id = ? AND quote_currency = ? ORDER BY fetched_at DESC, id DESC LIMIT 1`);
  const historyQueries = new Map<number, { rows: Database.Statement; count: Database.Statement }>();
  const history = db.transaction((ids: number[], start: string | null, end: string | null, limit: number, cursor: HistoryPosition | null) => {
    let queries = historyQueries.get(ids.length);
    if (!queries) {
      const placeholders = ids.map(() => '?').join(',');
      const filter = `FROM prices WHERE cryptocurrency_id IN (${placeholders}) AND (? IS NULL OR fetched_at >= ?) AND (? IS NULL OR fetched_at <= ?)`;
      queries = {
        rows: db.prepare(`SELECT id AS cursor_id, cryptocurrency_id, price, quote_currency, fetched_at, source_updated_at ${filter} AND (? IS NULL OR fetched_at < ? OR (fetched_at = ? AND id < ?)) ORDER BY fetched_at DESC, id DESC LIMIT ?`),
        count: db.prepare(`SELECT COUNT(*) AS total ${filter}`),
      };
      historyQueries.set(ids.length, queries);
    }
    const params = [...ids, start, start, end, end];
    const rows = queries.rows.all(...params, cursor?.fetchedAt ?? null, cursor?.fetchedAt ?? null, cursor?.fetchedAt ?? null, cursor?.id ?? null, limit + 1) as Array<PriceRecord & { cursor_id: number }>;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeHistoryCursor({ fetchedAt: last.fetched_at, id: last.cursor_id }, { ids, start, end }) : null;
    const data = page.map(({ cursor_id: _id, ...record }) => record);
    const { total } = queries.count.get(...params) as { total: number };
    return { data, meta: { count: limit, total, next_cursor: nextCursor } };
  });

  return {
    findById(id: number): PriceCurrency | undefined { return byId.get(id) as PriceCurrency | undefined; },
    findBySlug(slug: string): PriceCurrency[] { return bySlug.all(slug) as PriceCurrency[]; },
    latest(id: number, currency: string): PriceRecord | null { return (latest.get(id, currency) as PriceRecord | undefined) ?? null; },
    history,
  };
}

export type PriceReader = ReturnType<typeof createPriceReader>;
