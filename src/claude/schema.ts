import type { UsageRecord } from './models';

/**
 * Verified Claude Code transcript schema (see docs/FINDINGS.md):
 *   { type: "assistant", timestamp: ISO-8601, sessionId, requestId, isSidechain,
 *     message: { id, model, usage: { input_tokens, output_tokens,
 *       cache_creation_input_tokens, cache_read_input_tokens, ... } } }
 * Claude Code writes one line per content block with identical usage, so
 * records must be de-duplicated by message.id.
 */

export type IgnoreReason = 'empty' | 'no-usage' | 'not-assistant' | 'synthetic' | 'zero-usage';

export type LineResult =
  | { kind: 'record'; record: UsageRecord; warnings: string[] }
  | { kind: 'ignored'; reason: IgnoreReason }
  | { kind: 'malformed'; reason: string }
  | { kind: 'schema-mismatch'; reason: string };

const TOKEN_FIELDS = [
  ['input_tokens', 'input'],
  ['output_tokens', 'output'],
  ['cache_creation_input_tokens', 'cacheCreate'],
  ['cache_read_input_tokens', 'cacheRead'],
] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function parseUsageLine(line: string): LineResult {
  const text = line.trim();
  if (text.length === 0) return { kind: 'ignored', reason: 'empty' };
  // Cheap pre-filter: ~70% of lines are not API responses.
  if (!text.includes('"usage"')) return { kind: 'ignored', reason: 'no-usage' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { kind: 'malformed', reason: (err as Error).message.slice(0, 120) };
  }
  if (!isObject(parsed)) return { kind: 'malformed', reason: 'line is not a JSON object' };
  if (parsed.type !== 'assistant') return { kind: 'ignored', reason: 'not-assistant' };

  const message = parsed.message;
  if (!isObject(message) || !isObject(message.usage)) return { kind: 'ignored', reason: 'no-usage' };

  const model = str(message.model) ?? 'unknown';
  if (model === '<synthetic>') return { kind: 'ignored', reason: 'synthetic' };

  const usage = message.usage;
  const warnings: string[] = [];
  const tokens = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  let present = 0;
  for (const [field, key] of TOKEN_FIELDS) {
    const v = usage[field];
    if (v === undefined || v === null) {
      warnings.push(`missing:${field}`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return { kind: 'schema-mismatch', reason: `usage.${field} is not a non-negative number` };
    }
    tokens[key] = v;
    present++;
  }
  if (present === 0) return { kind: 'schema-mismatch', reason: 'usage object has none of the known token fields' };

  const ts = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN;
  if (Number.isNaN(ts)) return { kind: 'schema-mismatch', reason: 'missing or unparseable timestamp' };

  const id = str(message.id) ?? str(parsed.requestId) ?? str(parsed.uuid);
  if (!id) return { kind: 'schema-mismatch', reason: 'no message.id, requestId or uuid' };

  if (tokens.input + tokens.output + tokens.cacheCreate + tokens.cacheRead === 0) {
    return { kind: 'ignored', reason: 'zero-usage' };
  }

  return {
    kind: 'record',
    warnings,
    record: {
      id,
      timestamp: ts,
      sessionId: str(parsed.sessionId) ?? 'unknown',
      model,
      ...tokens,
      sidechain: parsed.isSidechain === true,
    },
  };
}
