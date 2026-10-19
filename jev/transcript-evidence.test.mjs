import assert from 'node:assert/strict';
import { parseTranscript } from './transcript-evidence.mjs';
import { transcript } from './report-fixtures.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('brief, ordered calls with results; api-request-blob duplicates ignored', () => {
  const t = parseTranscript(transcript('Do the thing.', [['Read', { file_path: 'a.mjs' }, 'content'], ['Bash', { command: 'node a.test.mjs' }, 'boom', true]]));
  assert.equal(t.brief, 'Do the thing.');
  assert.equal(t.calls.length, 2);
  assert.deepEqual(t.calls.map((c) => [c.i, c.name, c.text, c.is_error, c.done]), [[0, 'Read', 'content', false, true], [1, 'Bash', 'boom', true, true]]);
});
test('call without a result stays not done', () => {
  const lines = transcript('b', [['Read', {}]]).split('\n');
  const t = parseTranscript(lines.slice(0, 3).join('\n'));
  assert.equal(t.calls[0].done, false);
});
test('truncated: no brief, bad first line skipped', () => {
  const t = parseTranscript('{"half":' + '\n' + transcript('b', [['Grep', {}]]), { truncated: true });
  assert.equal(t.brief, null);
  assert.equal(t.calls.length, 1);
});
test('brief given as text blocks; tool_result-only user message is not the brief', () => {
  const t = parseTranscript(JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'Verifies: a1' }] } }));
  assert.equal(t.brief, 'Verifies: a1');
  assert.equal(parseTranscript(transcript('x', [['Read', {}]]).split('\n').slice(2).join('\n')).brief, null);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
