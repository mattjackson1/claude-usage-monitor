// Regenerates tests/fixtures/*.jsonl. Run: npx tsx scripts/make-fixtures.mts
import { writeFileSync, mkdirSync } from 'node:fs';
import { assistantLines } from '../tests/helpers';

mkdirSync('tests/fixtures', { recursive: true });
const other = JSON.stringify({ type: 'user', timestamp: '2026-10-06T14:59:00.000Z', message: { role: 'user', content: 'hello "usage" docs' } }) + '\n';

writeFileSync(
  'tests/fixtures/valid.jsonl',
  other +
    assistantLines({ id: 'msg_a', ts: '2026-10-06T15:00:00.000Z', blocks: 3, input: 2, output: 100, cc: 1000, cr: 0, model: 'claude-fable-5-1' }) +
    assistantLines({ id: 'msg_b', ts: '2026-10-06T15:01:00.000Z', blocks: 2, input: 3, output: 200, cc: 0, cr: 5000, model: 'claude-fable-5-1' }) +
    assistantLines({ id: 'msg_c', ts: '2026-10-06T15:02:00.000Z', input: 4, output: 300, cc: 10, cr: 6000, model: 'claude-sonnet-5-5', sidechain: true }),
);

writeFileSync(
  'tests/fixtures/malformed.jsonl',
  [
    assistantLines({ id: 'ok_1', ts: '2026-10-06T15:00:00.000Z' }).trim(),
    '{"type":"assistant","message":{"usage":{"input_tokens":1,',
    'not json at all "usage"',
    '',
    '[1,2,3,"usage"]',
    JSON.stringify({ type: 'assistant', timestamp: 'garbage', message: { id: 'x', model: 'm', usage: { input_tokens: 1, output_tokens: 1 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:00:00.000Z', message: { id: 'x2', model: 'm', usage: { input_tokens: 'many', output_tokens: 1 } } }),
    assistantLines({ id: 'ok_2', ts: '2026-10-06T15:05:00.000Z' }).trim(),
    '',
  ].join('\n'),
);

// Variants: no cache fields at all, extra unknown fields, no requestId, id only on requestId.
writeFileSync(
  'tests/fixtures/schema-variants.jsonl',
  [
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:00:00.000Z', sessionId: 's', message: { id: 'old_1', model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: 7 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:01:00.000Z', requestId: 'req_only', message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 9, brand_new_field: { x: 1 } }, newTopLevel: true }, futureThing: [1] }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T15:02:00.000Z', message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    '',
  ].join('\n'),
);
writeFileSync('tests/fixtures/empty.jsonl', '');
console.log('fixtures written');
