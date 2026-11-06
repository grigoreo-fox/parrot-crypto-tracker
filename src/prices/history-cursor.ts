export interface HistoryPosition { fetchedAt: string; id: number }
export interface HistoryFilter { ids: number[]; start: string | null; end: string | null }

function normalized(filter: HistoryFilter) {
  return { ids: [...filter.ids].sort((a, b) => a - b), start: filter.start, end: filter.end };
}

export function encodeHistoryCursor(position: HistoryPosition, filter: HistoryFilter): string {
  return Buffer.from(JSON.stringify({ v: 1, position, filter: normalized(filter) })).toString('base64url');
}

export function decodeHistoryCursor(value: unknown, filter: HistoryFilter): HistoryPosition | undefined {
  if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !('v' in parsed) || parsed.v !== 1 || !('position' in parsed) || !('filter' in parsed)) return undefined;
    const position = parsed.position;
    if (!position || typeof position !== 'object' || !('id' in position) || !('fetchedAt' in position)) return undefined;
    if (typeof position.id !== 'number' || !Number.isSafeInteger(position.id) || position.id < 1 || typeof position.fetchedAt !== 'string') return undefined;
    const timestamp = position.fetchedAt;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)) return undefined;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) return undefined;
    if (JSON.stringify(parsed.filter) !== JSON.stringify(normalized(filter))) return undefined;
    return { id: position.id, fetchedAt: timestamp };
  } catch { return undefined; }
}
