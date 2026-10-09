import { describe, expect, it } from 'vitest';
import { parseUsageLine } from '../../src/claude/schema';
import { assistantLines } from '../helpers';

describe('parseUsageLine', () => {
  it('parses a verified assistant usage line', () => {
    const r = parseUsageLine(assistantLines({ id: 'm1', input: 2, output: 3, cc: 4, cr: 5, sidechain: true, model: 'claude-fable-5-1' }));
    expect(r.kind).toBe('record');
    if (r.kind !== 'record') return;
    expect(r.record).toEqual({
      id: 'm1',
      timestamp: Date.parse('2026-10-06T15:00:00.000Z'),
      sessionId: 's1',
      model: 'claude-fable-5-1',
      input: 2,
      output: 3,
      cacheCreate: 4,
      cacheRead: 5,
      sidechain: true,
    });
    expect(r.warnings).toEqual([]);
  });

  it('ignores empty, usage-less and non-assistant lines', () => {
    expect(parseUsageLine('   ')).toEqual({ kind: 'ignored', reason: 'empty' });
    expect(parseUsageLine('{"type":"user"}')).toEqual({ kind: 'ignored', reason: 'no-usage' });
    expect(parseUsageLine('{"type":"user","usage":{"input_tokens":1}}')).toEqual({ kind: 'ignored', reason: 'not-assistant' });
    expect(parseUsageLine('{"type":"assistant","message":{"content":"usage"}}')).toEqual({ kind: 'ignored', reason: 'no-usage' });
  });

  it('skips synthetic and all-zero usage', () => {
    const synth = JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:00:00.000Z', message: { id: 'a', model: '<synthetic>', usage: { input_tokens: 5, output_tokens: 5 } } });
    expect(parseUsageLine(synth)).toEqual({ kind: 'ignored', reason: 'synthetic' });
    expect(parseUsageLine(assistantLines({ input: 0, output: 0, cc: 0, cr: 0 }))).toEqual({ kind: 'ignored', reason: 'zero-usage' });
  });

  it('reports malformed and truncated JSON', () => {
    expect(parseUsageLine('{"usage": ').kind).toBe('malformed');
    expect(parseUsageLine('[1,"usage"]')).toEqual({ kind: 'malformed', reason: 'line is not a JSON object' });
  });

  it('tolerates missing token fields with warnings', () => {
    const line = JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:00:00.000Z', message: { id: 'a', model: 'm', usage: { input_tokens: 5, output_tokens: 1 } } });
    const r = parseUsageLine(line);
    expect(r.kind).toBe('record');
    if (r.kind === 'record') {
      expect(r.record.cacheRead).toBe(0);
      expect(r.warnings).toEqual(['missing:cache_creation_input_tokens', 'missing:cache_read_input_tokens']);
    }
  });

  it('flags schema mismatches', () => {
    const base = { type: 'assistant', timestamp: '2026-10-06T15:00:00.000Z', message: { id: 'a', model: 'm', usage: { input_tokens: 1 } } };
    expect(parseUsageLine(JSON.stringify({ ...base, message: { ...base.message, usage: { input_tokens: '1' } } })).kind).toBe('schema-mismatch');
    expect(parseUsageLine(JSON.stringify({ ...base, message: { ...base.message, usage: { input_tokens: -1 } } })).kind).toBe('schema-mismatch');
    expect(parseUsageLine(JSON.stringify({ ...base, message: { ...base.message, usage: { something: 1 } } })).kind).toBe('schema-mismatch');
    expect(parseUsageLine(JSON.stringify({ ...base, timestamp: 'nope' })).kind).toBe('schema-mismatch');
    expect(parseUsageLine(JSON.stringify({ ...base, timestamp: undefined })).kind).toBe('schema-mismatch');
    expect(parseUsageLine(JSON.stringify({ ...base, message: { model: 'm', usage: { input_tokens: 1 } } })).kind).toBe('schema-mismatch');
  });

  it('falls back to requestId then uuid for the id', () => {
    const mk = (extra: object, msgId?: string) =>
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:00:00.000Z', ...extra, message: { id: msgId, model: 'm', usage: { input_tokens: 1 } } });
    const a = parseUsageLine(mk({ requestId: 'req_9' }));
    const b = parseUsageLine(mk({ uuid: 'uuid-9' }));
    expect(a.kind === 'record' && a.record.id).toBe('req_9');
    expect(b.kind === 'record' && b.record.id).toBe('uuid-9');
  });

  it('defaults model and session when absent', () => {
    const line = JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:00:00.000Z', message: { id: 'a', usage: { input_tokens: 1 } } });
    const r = parseUsageLine(line);
    expect(r.kind === 'record' && [r.record.model, r.record.sessionId, r.record.sidechain]).toEqual(['unknown', 'unknown', false]);
  });
});
