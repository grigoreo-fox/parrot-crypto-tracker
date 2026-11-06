import type Database from 'better-sqlite3';
import type { LatestQuote } from '../cmc/client';

export function createTrackingRepository(db: Database.Database) {
  const findCatalog = db.prepare('SELECT id FROM cryptocurrencies WHERE id = ?');
  const add = db.prepare('INSERT INTO tracked_currencies (cryptocurrency_id) VALUES (?) ON CONFLICT(cryptocurrency_id) DO NOTHING');
  const active = db.prepare('SELECT cryptocurrency_id AS id FROM tracked_currencies WHERE is_active = 1 ORDER BY cryptocurrency_id');
  const list = db.prepare(`SELECT c.id, c.name, c.symbol, c.slug, t.is_active, t.created_at, t.updated_at, t.last_synced_at
    FROM tracked_currencies t JOIN cryptocurrencies c ON c.id = t.cryptocurrency_id
    ORDER BY c.id LIMIT ? OFFSET ?`);
  const countTracked = db.prepare('SELECT COUNT(*) AS total FROM tracked_currencies');
  const setActive = db.prepare("UPDATE tracked_currencies SET is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE cryptocurrency_id = ?");
  const remove = db.prepare('DELETE FROM tracked_currencies WHERE cryptocurrency_id = ?');
  const insertPrice = db.prepare(`INSERT INTO prices (cryptocurrency_id, price, quote_currency, source_updated_at)
    SELECT cryptocurrency_id, @price, @quoteCurrency, @sourceUpdatedAt
    FROM tracked_currencies WHERE cryptocurrency_id = @id AND is_active = 1`);
  const updateSync = db.prepare("UPDATE tracked_currencies SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE cryptocurrency_id = ? AND is_active = 1");
  const addTracked = db.transaction((id: number): 'created' | 'not_found' | 'conflict' => {
    if (!findCatalog.get(id)) return 'not_found';
    return add.run(id).changes === 1 ? 'created' : 'conflict';
  });
  const savePrices = db.transaction((quotes: readonly LatestQuote[]) => {
    let count = 0;
    for (const quote of quotes) {
      if (insertPrice.run(quote).changes) {
        updateSync.run(quote.id);
        count++;
      }
    }
    return count;
  });
  const listTracked = db.transaction((start: number, limit: number) => {
    const data = (list.all(limit, start - 1) as Array<{ id: number; name: string; symbol: string; slug: string; is_active: number; created_at: string; updated_at: string; last_synced_at: string | null }>).map((row) => ({ ...row, is_active: row.is_active === 1 }));
    const { total } = countTracked.get() as { total: number };
    return { data, pagination: { start, limit, total } };
  });
  return {
    addTracked,
    listTracked,
    setTrackedActive: (id: number, isActive: boolean) => setActive.run(isActive ? 1 : 0, id).changes === 1,
    deleteTracked: (id: number) => remove.run(id).changes === 1,
    activeIds: () => (active.all() as { id: number }[]).map((row) => row.id),
    savePrices,
  };
}
