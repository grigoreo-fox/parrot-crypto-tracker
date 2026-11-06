import { CmcError } from '../cmc/client';
import type { CatalogCurrency } from '../cmc/client';
import type { Logger } from '../logger/logger';
import { syncCatalog } from './sync-catalog';

interface CatalogSource { map(start: number, limit: number, signal?: AbortSignal): Promise<CatalogCurrency[]> }
interface CatalogState {
  savePage(currencies: readonly CatalogCurrency[]): void;
  latestUpdatedAt(): string | null;
}

/** Next future slot on the grid anchored at the latest catalog update. An empty catalog is due immediately. */
export function catalogSyncDelayMs(lastUpdatedAt: string | null, intervalMs: number, now = Date.now()): number {
  if (!lastUpdatedAt) return 0;
  const updatedAt = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(updatedAt)) return 0;
  const elapsed = now - updatedAt;
  if (elapsed < 0) return updatedAt + intervalMs - now;
  const remainder = elapsed % intervalMs;
  return remainder === 0 ? intervalMs : intervalMs - remainder;
}

export function createCatalogScheduler(source: CatalogSource, repository: CatalogState, logger: Logger, intervalMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let started = false;
  let stopped = false;

  function arm(delay: number): void {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = undefined; begin(); }, delay);
  }

  function begin(): void {
    if (active || stopped) return;
    controller = new AbortController();
    const signal = controller.signal;
    let failed = false;
    logger.info('Catalog synchronization started');
    active = syncCatalog(source, repository, signal).then((count) => {
      if (!signal.aborted) logger.info('Catalog synchronization completed', { count });
    }).catch((error: unknown) => {
      failed = true;
      if (!signal.aborted) logger.error('Catalog synchronization failed', { kind: error instanceof CmcError ? error.kind : 'internal' });
    }).finally(() => {
      active = undefined;
      controller = undefined;
      if (stopped || signal.aborted) return;
      const delay = failed ? intervalMs : catalogSyncDelayMs(repository.latestUpdatedAt(), intervalMs);
      arm(delay > 0 ? delay : intervalMs);
    });
  }

  return {
    start(): void {
      if (started || stopped) return;
      started = true;
      const delay = catalogSyncDelayMs(repository.latestUpdatedAt(), intervalMs);
      if (delay === 0) begin();
      else {
        logger.info('Catalog synchronization postponed', { delayMs: delay });
        arm(delay);
      }
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      await active;
    },
  };
}
