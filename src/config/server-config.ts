import { loadConfig } from './config';

export function loadServerConfig() {
  const base = loadConfig();
  const apiToken = process.env.API_BEARER_TOKEN;
  const cmcApiKey = process.env.CMC_PRO_API_KEY;
  if (!apiToken || /\s/.test(apiToken) || apiToken.length < 32) throw new Error('API_BEARER_TOKEN must contain at least 32 non-whitespace characters');
  if (!cmcApiKey || /\s/.test(cmcApiKey)) throw new Error('CMC_PRO_API_KEY must not be empty or contain whitespace');
  const quoteCurrency = (process.env.QUOTE_CURRENCY ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(quoteCurrency)) throw new Error('QUOTE_CURRENCY must be an alphanumeric currency symbol');
  const intervalMs = (name: string, defaultMinutes: string): number => {
    const text = process.env[name] ?? defaultMinutes;
    const minutes = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 35791) {
      throw new Error(`${name} must be an integer between 1 and 35791 minutes`);
    }
    return minutes * 60000;
  };
  const priceSyncIntervalMs = intervalMs('PRICE_SYNC_INTERVAL_MINUTES', '5');
  const catalogSyncIntervalMs = intervalMs('CATALOG_SYNC_INTERVAL_MINUTES', '1440');
  return { ...base, apiToken, cmcApiKey, quoteCurrency, priceSyncIntervalMs, catalogSyncIntervalMs };
}
