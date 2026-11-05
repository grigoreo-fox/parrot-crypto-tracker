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

  return { savePage };
}
