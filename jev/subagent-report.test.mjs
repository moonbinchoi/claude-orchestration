import assert from 'node:assert/strict';
import { readReport } from './subagent-report.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const hb = (m) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking' }, { type: 'tool_use', name: 'SubagentHandback', input: { message: m } }] } });
const user = (s) => JSON.stringify({ type: 'user', message: { role: 'user', content: s } });
const toolResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });

test('status regex variants', () => {
  for (const [first, want] of [['> DONE', 'DONE'], ['# PARTIAL', 'PARTIAL'], ['DONEX', 'unknown'], ['\n\n  BLOCKED - x', 'BLOCKED'], ['Here is my answer', 'unknown'], ['**BLOCKED**: nope', 'BLOCKED'], ['Status: DONE', 'DONE'], ['**Status:** PARTIAL - x', 'PARTIAL'], ['Status: done', 'unknown'], ['Status unclear', 'unknown'],
    ['STATUS: DONE (some items "not found", noted).', 'DONE'], ['STATUS: PARTIAL. Full text is at D:\\x.md', 'PARTIAL'], ['STATUS: BLOCKED - no access', 'BLOCKED'],
    ['SUBAGENT-DONE', 'unknown'], ['Verdicts: rule=partial', 'unknown'], ['E:/x/runs/J2-N.md - done', 'unknown'], ['Status: EXISTS (not fixed)', 'unknown']]) {
    assert.equal(readReport({ last_assistant_message: first }).status, want, first);
  }
});
test('last_assistant_message wins when non-empty', () => {
  const r = readReport({ last_assistant_message: 'DONE\nx', agent_transcript_path: 'p' }, () => hb('BLOCKED'));
  assert.deepEqual(r, { text: 'DONE\nx', status: 'DONE', pending: false });
});
test('non-empty last_assistant_message without a status line: handback status wins; else the message itself', () => {
  assert.deepEqual(readReport({ last_assistant_message: 'summary text', agent_transcript_path: 'p' }, () => hb('BLOCKED ...')), { text: 'BLOCKED ...', status: 'BLOCKED', pending: false });
  assert.deepEqual(readReport({ last_assistant_message: 'summary text', agent_transcript_path: 'p' }, () => { throw new Error('gone'); }), { text: 'summary text', status: 'unknown', pending: true });
});
test('falls back to the last SubagentHandback; reader error or no path -> unknown', () => {
  const t = [hb('PARTIAL\nold'), hb('BLOCKED\nwhy')].join('\n');
  assert.deepEqual(readReport({ last_assistant_message: '  ', agent_transcript_path: 'p' }, () => t), { text: 'BLOCKED\nwhy', status: 'BLOCKED', pending: false });
  assert.deepEqual(readReport({ agent_transcript_path: 'p' }, () => { throw new Error('gone'); }), { text: '', status: 'unknown', pending: true });
  assert.deepEqual(readReport({}, () => t), { text: '', status: 'unknown', pending: false });
  assert.equal(readReport(null).status, 'unknown');
});
test('resume: a handback before a later prompt is stale; pending until the new one lands', () => {
  const p = { last_assistant_message: '', agent_transcript_path: 'p' };
  assert.deepEqual(readReport(p, () => [user('brief'), hb('DONE\nold'), toolResult, user('The coordinator sent a message...')].join('\n')), { text: '', status: 'unknown', pending: true });
  assert.deepEqual(readReport(p, () => [user('brief'), hb('DONE\nold'), toolResult, user('resume'), hb('PARTIAL\nnew')].join('\n')), { text: 'PARTIAL\nnew', status: 'PARTIAL', pending: false });
  const blob = JSON.stringify({ type: 'api-request-blob', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'DONE\nold' } }] } });
  assert.deepEqual(readReport(p, () => [hb('DONE\nold'), user('resume'), blob].join('\n')), { text: '', status: 'unknown', pending: true });
  assert.deepEqual(readReport(p, () => user('brief')), { text: '', status: 'unknown', pending: true });
  assert.deepEqual(readReport(p, () => hb('ISSUES 23')), { text: 'ISSUES 23', status: 'unknown', pending: false });
});
for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
