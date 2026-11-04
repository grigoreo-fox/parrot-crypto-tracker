import express from 'express';

export interface HealthDependencies {
  checkDatabase(): void;
}

/** Creates an HTTP application without opening a network port. */
export function createApp(dependencies: HealthDependencies): express.Express {
  const app = express();

  app.get('/health', (_request, response) => {
    try {
      dependencies.checkDatabase();
      response.status(200).json({ status: 'ok', database: 'ok' });
    } catch {
      // Do not expose database errors or paths in a public endpoint.
      response.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  return app;
}
