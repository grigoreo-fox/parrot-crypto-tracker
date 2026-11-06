import express, { type ErrorRequestHandler } from 'express';
import { bearerAuth } from './auth';
import { createPriceRouter } from './prices/price-routes';
import type { PriceReader } from './database/price-reader';

interface TrackedCurrency {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
}

export interface HealthDependencies {
  checkDatabase(): void;
  prices?: { apiToken: string; quoteCurrency: string; reader: PriceReader };
  catalog?: { apiToken: string; search(query: string | null, start: number, limit: number): { data: Array<{ id: number; name: string; symbol: string; slug: string }>; pagination: { start: number; limit: number; total: number } } };
  tracking?: {
    apiToken: string;
    addTracked(id: number): 'created' | 'not_found' | 'conflict';
    listTracked(start: number, limit: number): { data: TrackedCurrency[]; pagination: { start: number; limit: number; total: number } };
    setTrackedActive(id: number, isActive: boolean): boolean;
    deleteTracked(id: number): boolean;
  };
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/** Creates an HTTP application without opening a network port. */
export function createApp(dependencies: HealthDependencies): express.Express {
  const app = express();

  app.get('/health', (_request, response) => {
    try {
      dependencies.checkDatabase();
      response.status(200).json({ status: 'ok', database: 'ok' });
    } catch {
      response.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  if (dependencies.catalog) {
    const catalog = dependencies.catalog;
    app.get('/v1/cryptocurrency/map', bearerAuth(catalog.apiToken), (request, response) => {
      const start = positiveInteger(request.query.start ?? '1');
      const limit = positiveInteger(request.query.limit ?? '100');
      const query = request.query.q;
      if (start === undefined || limit === undefined || limit > 100 || (query !== undefined && (typeof query !== 'string' || !query.trim() || query.trim().length > 100))) {
        response.status(400).json({ error: 'Expected start >= 1, limit between 1 and 100, and optional q of 1 to 100 characters' });
        return;
      }
      response.json(catalog.search(typeof query === 'string' ? query.trim() : null, start, limit));
    });
  }

  if (dependencies.tracking) {
    const tracking = dependencies.tracking;
    const router = express.Router();
    router.use(bearerAuth(tracking.apiToken));
    router.get('/', (request, response) => {
      const start = positiveInteger(request.query.start ?? '1');
      const limit = positiveInteger(request.query.limit ?? '100');
      if (start === undefined || limit === undefined || limit > 100) {
        response.status(400).json({ error: 'Expected start >= 1 and limit between 1 and 100' });
        return;
      }
      response.json(tracking.listTracked(start, limit));
    });
    router.post('/', express.json({ limit: '16kb' }), (request, response) => {
      const body: unknown = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('id' in body) || typeof body.id !== 'number' || !Number.isSafeInteger(body.id) || body.id <= 0) {
        response.status(400).json({ error: 'Expected a positive integer id' });
        return;
      }
      const result = tracking.addTracked(body.id);
      if (result === 'not_found') { response.status(404).json({ error: 'Currency not found' }); return; }
      if (result === 'conflict') { response.status(409).json({ error: 'Currency already tracked' }); return; }
      response.status(201).json({ data: { id: body.id } });
    });
    router.patch('/', express.json({ limit: '16kb' }), (request, response) => {
      const id = positiveInteger(request.query.id);
      const body: unknown = request.body;
      if (id === undefined || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('is_active' in body) || typeof body.is_active !== 'boolean') {
        response.status(400).json({ error: 'Expected a positive integer id and boolean is_active' });
        return;
      }
      if (!tracking.setTrackedActive(id, body.is_active)) { response.status(404).json({ error: 'Tracked currency not found' }); return; }
      response.json({ data: { id, is_active: body.is_active } });
    });
    router.delete('/', (request, response) => {
      const id = positiveInteger(request.query.id);
      if (id === undefined) { response.status(400).json({ error: 'Expected a positive integer id' }); return; }
      if (!tracking.deleteTracked(id)) { response.status(404).json({ error: 'Tracked currency not found' }); return; }
      response.status(204).end();
    });
    app.use('/v1/cryptocurrency/tracked', router);
  }

  if (dependencies.prices) {
    const { reader, apiToken, quoteCurrency } = dependencies.prices;
    app.use('/v1/cryptocurrency/prices', createPriceRouter(reader, apiToken, quoteCurrency));
  }

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413) { response.status(status).json({ error: 'Invalid request body' }); return; }
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(handleError);
  return app;
}
