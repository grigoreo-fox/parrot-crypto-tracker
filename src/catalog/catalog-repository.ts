import type Database from 'better-sqlite3';
import type { CatalogCurrency } from '../cmc/client';

/** Prepared once per repository; each page is committed as one transaction. */
export function createCatalogRepository(database: Database.Database) {
  const upsert = database.prepare(`
    INSERT INTO cryptocurrencies (id, name, symbol, slug)
    VALUES (@id, @name, @symbol, @slug)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      symbol = excluded.symbol,
      slug = excluded.slug,
      catalog_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);
  const savePage = database.transaction((currencies: readonly CatalogCurrency[]) => {
    for (const currency of currencies) upsert.run(currency);
  });

  const filter = "WHERE (? IS NULL OR name LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')";
  const searchRows = database.prepare(`SELECT id, name, symbol, slug FROM cryptocurrencies ${filter} ORDER BY id LIMIT ? OFFSET ?`);
  const countRows = database.prepare(`SELECT COUNT(*) AS total FROM cryptocurrencies ${filter}`);
  const latestUpdatedAtQuery = database.prepare('SELECT MAX(catalog_updated_at) AS updated_at FROM cryptocurrencies');
  const search = database.transaction((query: string | null, start: number, limit: number) => {
    const pattern = query === null ? null : `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const params = [pattern, pattern, pattern, pattern];
    const data = searchRows.all(...params, limit, start - 1) as CatalogCurrency[];
    const { total } = countRows.get(...params) as { total: number };
    return { data, pagination: { start, limit, total } };
  });

  return {
    savePage,
    search,
    latestUpdatedAt: (): string | null => (latestUpdatedAtQuery.get() as { updated_at: string | null }).updated_at,
  };
}
