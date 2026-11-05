import type { LatestQuote, QuotesResult } from '../cmc/client';
import type { Logger } from '../logger/logger';
import { CmcError } from '../cmc/client';

interface PriceSource { quotesLatest(ids: readonly number[], signal?: AbortSignal): Promise<QuotesResult> }
interface PriceStore { activeIds(): number[]; savePrices(quotes: readonly LatestQuote[]): number }

export function createPriceSync(source: PriceSource, store: PriceStore, logger: Logger, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let stopped = false;

  function run(): void {
    if (active || stopped) return;
    controller = new AbortController();
    const signal = controller.signal;
    active = (async () => {
      const ids = store.activeIds();
      if (!ids.length || signal.aborted) return;
      const result = await source.quotesLatest(ids, signal);
      if (signal.aborted) return;
      const count = store.savePrices(result.quotes);
      if (result.missingIds.length) logger.warn('Some tracked currencies have no CMC quote', { ids: result.missingIds });
      logger.info('Price synchronization completed', { count });
    })().catch((error: unknown) => {
      if (!signal.aborted) logger.error('Price synchronization failed', { kind: error instanceof CmcError ? error.kind : 'internal' });
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
