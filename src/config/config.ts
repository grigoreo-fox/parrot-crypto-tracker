import { config as loadDotenv } from 'dotenv';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  port: number;
  databasePath: string;
  logLevel: LogLevel;
}

/** Reads configuration without modifying the supplied environment. */
export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  const portText = env.PORT ?? '3000';
  if (!/^\d+$/.test(portText)) throw new Error('PORT must be an integer between 1 and 65535');
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const databasePath = (env.DATABASE_PATH ?? './data.sqlite').trim();
  if (!databasePath) throw new Error('DATABASE_PATH must not be empty');

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.some((level) => level === logLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  return { port, databasePath, logLevel: logLevel as LogLevel };
}

/** Loads optional .env without overriding environment variables, then validates settings. */
export function loadConfig(): AppConfig {
  const result = loadDotenv({ quiet: true });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw result.error;
  }
  return readConfig(process.env);
}
