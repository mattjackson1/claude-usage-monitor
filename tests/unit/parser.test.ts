import { appendFile, truncate, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNewRecords } from '../../src/claude/parser';
import { NodeFileSystem } from '../../src/platform/filesystem';
import { assistantLines, makeTmp } from '../helpers';

const fs = new NodeFileSystem();
const fixture = (n: string) => path.join(__dirname, '..', 'fixtures', n);

describe('readNewRecords (fixtures)', () => {
  it('parses valid usage and returns duplicate blocks as repeated records', async () => {
    const r = await readNewRecords(fs, fixture('valid.jsonl'), undefined);
    expect(r).toBeDefined();
    // 3 + 2 + 1 assistant lines; de-duplication is the store's job.
    expect(r?.records.map((x) => x.id)).toEqual(['msg_a', 'msg_a', 'msg_a', 'msg_b', 'msg_b', 'msg_c']);
    expect(r?.stats.ignored).toBe(1);
    expect(r?.stats.malformed).toBe(0);
  });

  it('survives malformed, truncated and mismatched lines', async () => {
    const r = await readNewRecords(fs, fixture('malformed.jsonl'), undefined);
    expect(r?.records.map((x) => x.id)).toEqual(['ok_1', 'ok_2']);
    expect(r?.stats.malformed).toBe(3);
    expect(r?.stats.schemaMismatches).toBe(2);
    expect(r?.stats.samples.length).toBe(5);
  });

  it('handles schema variants', async () => {
    const r = await readNewRecords(fs, fixture('schema-variants.jsonl'), undefined);
    expect(r?.records.map((x) => [x.id, x.input, x.cacheRead])).toEqual([
      ['old_1', 5, 0],
      ['req_only', 1, 9],
    ]);
    expect(r?.stats.warnings['missing:cache_read_input_tokens']).toBe(1);
    expect(r?.stats.ignored).toBe(1); // the synthetic record
  });

  it('handles an empty file and a missing file', async () => {
    const e = await readNewRecords(fs, fixture('empty.jsonl'), undefined);
    expect(e?.records).toEqual([]);
    expect(await readNewRecords(fs, fixture('does-not-exist.jsonl'), undefined)).toBeUndefined();
  });
});

describe('readNewRecords (incremental)', () => {
  it('reads only appended bytes and skips unchanged files', async () => {
    const f = path.join(await makeTmp(), 's.jsonl');
    await writeFile(f, assistantLines({ id: 'a' }));
    const first = await readNewRecords(fs, f, undefined);
    expect(first?.records).toHaveLength(1);

    const same = await readNewRecords(fs, f, first?.cursor);
    expect(same?.changed).toBe(false);

    await appendFile(f, assistantLines({ id: 'b', ts: '2026-10-06T15:01:00.000Z' }));
    const second = await readNewRecords(fs, f, first?.cursor);
    expect(second?.records.map((r) => r.id)).toEqual(['b']);
    expect(second?.stats.lines).toBe(1);
  });

  it('waits for a partial trailing line to be completed', async () => {
    const f = path.join(await makeTmp(), 's.jsonl');
    const full = assistantLines({ id: 'p' });
    const cut = Math.floor(full.length / 2);
    await writeFile(f, assistantLines({ id: 'a' }) + full.slice(0, cut));
    const first = await readNewRecords(fs, f, undefined);
    expect(first?.records.map((r) => r.id)).toEqual(['a']);
    expect(first?.stats.malformed).toBe(0);

    await appendFile(f, full.slice(cut));
    const second = await readNewRecords(fs, f, first?.cursor);
    expect(second?.records.map((r) => r.id)).toEqual(['p']);
  });

  it('re-reads from the start when the file shrinks', async () => {
    const f = path.join(await makeTmp(), 's.jsonl');
    await writeFile(f, assistantLines({ id: 'a' }) + assistantLines({ id: 'b' }));
    const first = await readNewRecords(fs, f, undefined);
    await truncate(f, 0);
    await writeFile(f, assistantLines({ id: 'c' }));
    const second = await readNewRecords(fs, f, first?.cursor);
    expect(second?.reset).toBe(true);
    expect(second?.records.map((r) => r.id)).toEqual(['c']);
  });

  it('parses multi-byte characters and lines larger than a chunk', async () => {
    const f = path.join(await makeTmp(), 's.jsonl');
    const big = JSON.stringify({ type: 'user', pad: 'é'.repeat(50_000) }) + '\n';
    await writeFile(f, big + assistantLines({ id: 'u', model: 'modèle-é' }));
    const r = await readNewRecords(fs, f, undefined);
    expect(r?.records[0]?.model).toBe('modèle-é');
  });
});
