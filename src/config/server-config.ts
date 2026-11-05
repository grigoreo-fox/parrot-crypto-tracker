import { loadConfig } from './config';

export function loadServerConfig() {
  const base = loadConfig();
  const apiToken = process.env.API_BEARER_TOKEN;
  const cmcApiKey = process.env.CMC_PRO_API_KEY;
  if (!apiToken || /\s/.test(apiToken) || apiToken.length < 32) throw new Error('API_BEARER_TOKEN must contain at least 32 non-whitespace characters');
  if (!cmcApiKey || /\s/.test(cmcApiKey)) throw new Error('CMC_PRO_API_KEY must not be empty or contain whitespace');
  const quoteCurrency = (process.env.QUOTE_CURRENCY ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(quoteCurrency)) throw new Error('QUOTE_CURRENCY must be an alphanumeric currency symbol');
  const intervalText = process.env.PRICE_SYNC_INTERVAL_MS ?? '300000';
  const priceSyncIntervalMs = Number(intervalText);
  if (!/^\d+$/.test(intervalText) || !Number.isSafeInteger(priceSyncIntervalMs) || priceSyncIntervalMs < 1 || priceSyncIntervalMs > 2147483647) {
    throw new Error('PRICE_SYNC_INTERVAL_MS must be an integer between 1 and 2147483647');
  }
  return { ...base, apiToken, cmcApiKey, quoteCurrency, priceSyncIntervalMs };
}
