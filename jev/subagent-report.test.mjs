import assert from 'node:assert/strict';
import { readReport } from './subagent-report.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const hb = (m) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking' }, { type: 'tool_use', name: 'SubagentHandback', input: { message: m } }] } });

test('status regex variants', () => {
  for (const [first, want] of [['> DONE', 'DONE'], ['# PARTIAL', 'PARTIAL'], ['DONEX', 'unknown'], ['\n\n  BLOCKED - x', 'BLOCKED'], ['Here is my answer', 'unknown'], ['**BLOCKED**: nope', 'BLOCKED']]) {
    assert.equal(readReport({ last_assistant_message: first }).status, want, first);
  }
});
test('last_assistant_message wins when non-empty', () => {
  const r = readReport({ last_assistant_message: 'DONE\nx', agent_transcript_path: 'p' }, () => hb('BLOCKED'));
  assert.deepEqual(r, { text: 'DONE\nx', status: 'DONE' });
});
test('non-empty last_assistant_message without a status line: handback status wins; else the message itself', () => {
  assert.deepEqual(readReport({ last_assistant_message: 'summary text', agent_transcript_path: 'p' }, () => hb('BLOCKED ...')), { text: 'BLOCKED ...', status: 'BLOCKED' });
  assert.deepEqual(readReport({ last_assistant_message: 'summary text', agent_transcript_path: 'p' }, () => { throw new Error('gone'); }), { text: 'summary text', status: 'unknown' });
});
test('falls back to the last SubagentHandback; reader error or no path -> unknown', () => {
  const t = [hb('PARTIAL\nold'), hb('BLOCKED\nwhy')].join('\n');
  assert.deepEqual(readReport({ last_assistant_message: '  ', agent_transcript_path: 'p' }, () => t), { text: 'BLOCKED\nwhy', status: 'BLOCKED' });
  assert.deepEqual(readReport({ agent_transcript_path: 'p' }, () => { throw new Error('gone'); }), { text: '', status: 'unknown' });
  assert.deepEqual(readReport({}, () => t), { text: '', status: 'unknown' });
  assert.equal(readReport(null).status, 'unknown');
});
for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
