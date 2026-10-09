export const WINDOW_MS = 5 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** One de-duplicated assistant API response. */
export interface UsageRecord {
  /** message.id (falls back to requestId, then uuid). */
  id: string;
  /** Epoch ms from the line's ISO `timestamp`. */
  timestamp: number;
  sessionId: string;
  model: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  sidechain: boolean;
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number;
}

export type TokenBasis = 'all' | 'excludeCacheRead';

export function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 };
}

export function addRecord(t: TokenTotals, r: UsageRecord): void {
  t.input += r.input;
  t.output += r.output;
  t.cacheCreate += r.cacheCreate;
  t.cacheRead += r.cacheRead;
  t.total += r.input + r.output + r.cacheCreate + r.cacheRead;
}

/** Tokens counted toward usage/capacity under the chosen basis. */
export function countedTokens(t: TokenTotals, basis: TokenBasis): number {
  return basis === 'excludeCacheRead' ? t.total - t.cacheRead : t.total;
}

export function recordCounted(r: UsageRecord, basis: TokenBasis): number {
  const all = r.input + r.output + r.cacheCreate + r.cacheRead;
  return basis === 'excludeCacheRead' ? all - r.cacheRead : all;
}
