import type Database from 'better-sqlite3';

export interface PriceCurrency { id: number; name: string; symbol: string; slug: string }
export interface PriceRecord { cryptocurrency_id: number; price: number; quote_currency: string; fetched_at: string; source_updated_at: string | null }

/** Read-only queries; price history remains available after tracking is removed. */
export function createPriceReader(db: Database.Database) {
  const byId = db.prepare('SELECT id, name, symbol, slug FROM cryptocurrencies WHERE id = ?');
  const bySlug = db.prepare('SELECT id, name, symbol, slug FROM cryptocurrencies WHERE slug = ? LIMIT 2');
  const latest = db.prepare(`SELECT cryptocurrency_id, price, quote_currency, fetched_at, source_updated_at
    FROM prices WHERE cryptocurrency_id = ? AND quote_currency = ? ORDER BY fetched_at DESC, id DESC LIMIT 1`);
  const historyQueries = new Map<number, Database.Statement>();

  return {
    findById(id: number): PriceCurrency | undefined { return byId.get(id) as PriceCurrency | undefined; },
    findBySlug(slug: string): PriceCurrency[] { return bySlug.all(slug) as PriceCurrency[]; },
    latest(id: number, currency: string): PriceRecord | null { return (latest.get(id, currency) as PriceRecord | undefined) ?? null; },
    history(ids: readonly number[], start: string | null, end: string | null, count: number): PriceRecord[] {
      let query = historyQueries.get(ids.length);
      if (!query) {
        const placeholders = ids.map(() => '?').join(',');
        query = db.prepare(`SELECT cryptocurrency_id, price, quote_currency, fetched_at, source_updated_at FROM prices
          WHERE cryptocurrency_id IN (${placeholders}) AND (? IS NULL OR fetched_at >= ?) AND (? IS NULL OR fetched_at <= ?)
          ORDER BY fetched_at DESC, id DESC LIMIT ?`);
        historyQueries.set(ids.length, query);
      }
      return query.all(...ids, start, start, end, end, count) as PriceRecord[];
    },
  };
}

export type PriceReader = ReturnType<typeof createPriceReader>;
