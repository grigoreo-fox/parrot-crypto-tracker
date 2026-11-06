import { CmcError } from '../cmc/client';
import type { CatalogCurrency } from '../cmc/client';
import type { Logger } from '../logger/logger';
import { syncCatalog } from './sync-catalog';

interface CatalogSource { map(start: number, limit: number, signal?: AbortSignal): Promise<CatalogCurrency[]> }
interface CatalogWriter { savePage(currencies: readonly CatalogCurrency[]): void }

export function createCatalogScheduler(source: CatalogSource, repository: CatalogWriter, logger: Logger, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let stopped = false;

  function run(): void {
    if (active || stopped) return;
    controller = new AbortController();
    const signal = controller.signal;
    logger.info('Catalog synchronization started');
    active = syncCatalog(source, repository, signal).then((count) => {
      if (!signal.aborted) logger.info('Catalog synchronization completed', { count });
    }).catch((error: unknown) => {
      if (!signal.aborted) logger.error('Catalog synchronization failed', { kind: error instanceof CmcError ? error.kind : 'internal' });
    }).finally(() => { active = undefined; controller = undefined; });
  }

  return {
    start(): void {
      if (timer || stopped) return;
      run();
      timer = setInterval(run, intervalMs);
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearInterval(timer);
      controller?.abort();
      await active;
    },
  };
}
