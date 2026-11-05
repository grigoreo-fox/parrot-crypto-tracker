import type { CatalogCurrency } from '../cmc/client';

interface CatalogSource {
  map(start: number, limit: number, signal?: AbortSignal): Promise<CatalogCurrency[]>;
}
interface CatalogWriter {
  savePage(currencies: readonly CatalogCurrency[]): void;
}

/** Pages are saved independently; entries absent from a response are never deleted. */
export async function syncCatalog(source: CatalogSource, repository: CatalogWriter, signal?: AbortSignal): Promise<number> {
  const pageSize = 100;
  let start = 1;
  let saved = 0;
  for (;;) {
    if (signal?.aborted) throw new Error('Catalog sync cancelled');
    const page = await source.map(start, pageSize, signal);
    if (signal?.aborted) throw new Error('Catalog sync cancelled');
    if (page.length > pageSize) throw new Error('Catalog page exceeds requested size');
    if (page.length > 0) {
      repository.savePage(page);
      saved += page.length;
    }
    if (page.length < pageSize) return saved;
    start += page.length;
  }
}
