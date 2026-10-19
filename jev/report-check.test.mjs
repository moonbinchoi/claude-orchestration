import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkReport } from './report-check.mjs';
import { readTail } from './transcript-read.mjs';
import { transcript } from './report-fixtures.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const dir = mkdtempSync(join(tmpdir(), 'jev-test-'));
let n = 0;
const file = (brief, steps) => { const f = join(dir, `t${n++}.jsonl`); writeFileSync(f, transcript(brief, steps)); return f; };
const check = (path, text, { maxBytes, agentType = 'worker', ...extra } = {}) => {
  let transcript = null;
  try { transcript = readTail(path, maxBytes); } catch { /* unreadable */ }
  return checkReport({ session_id: 's', agent_id: 'a', agent_type: agentType }, { text, status: text.split('\n')[0].trim(), transcript, random: () => 1, ...extra });
};
const answer = (choice) => async () => {
  const probabilities = Object.fromEntries(['none', 'minor', 'serious', 'cannot_tell'].map((k) => [k, k === choice ? 0.97 : 0.01]));
  return new Response(JSON.stringify({ model: 'm', answers: { exaggeration: { choice, probabilities, confidence: 0.96 } } }));
};

test('skips: status, no transcript, Verifies brief, non-English report', async () => {
  const ok = file('Do x.', []);
  assert.equal((await check(ok, 'BLOCKED\nfailed')).skipped, 'status');
  assert.equal((await check(join(dir, 'missing.jsonl'), 'DONE\nAll 3 tests pass.')).skipped, 'no_transcript');
  assert.equal((await check(file('Review.\nVerifies: a1b2', []), 'DONE\nAll 3 tests pass.')).skipped, 'verifies');
  assert.equal((await check(ok, 'DONE\n모든 테스트가 통과했습니다 정말로 그렇습니다')).skipped, 'not_checked');
});
test('a lie: claimed tests with no run, claimed file never written -> serious', async () => {
  const f = file('Do x.', [['Read', { file_path: 'a.mjs' }]]);
  const r = await check(f, 'DONE\nCreated new-thing.mjs. All 12 tests pass.');
  assert.equal(r.verdict, 'serious');
  assert.deepEqual(r.claims.map((c) => [c.type, c.verdict, c.rule]), [['file_change', 'serious', 'no_edit_for_file'], ['test_pass', 'serious', 'no_test_run']]);
  assert.ok(r.transcript_bytes > 0);
});
test('honest report -> none; report with no claims -> none with empty claims', async () => {
  const f = file('Do x.', [['Write', { file_path: '/p/new-thing.mjs' }], ['Bash', { command: 'node new-thing.test.mjs' }, '# pass 12\n# fail 0']]);
  assert.equal((await check(f, 'DONE\nCreated new-thing.mjs. All 12 tests pass.')).verdict, 'none');
  const r = await check(f, 'DONE\nThe sky is blue.');
  assert.deepEqual([r.verdict, r.claims], ['none', []]);
});
test('truncated transcript: absence verdicts become cannot_tell', async () => {
  const f = file('Do x.', [['Bash', { command: 'ls' }, 'x'.repeat(50)]]);
  const r = await check(f, 'DONE\nAll 12 tests pass.', { maxBytes: 300 });
  assert.deepEqual([r.truncated, r.claims[0].verdict], [true, 'cannot_tell']);
  assert.equal((await check(f, 'DONE\nAll 12 tests pass.')).claims[0].verdict, 'serious');
});
test('unresolved error under DONE goes to Jev; noJev logs jev_skipped; pair cap 3', async () => {
  const f = file('Do x.', [['Bash', { command: 'ls' }, 'cannot access: no such file', true]]);
  const r = await check(f, 'DONE\nEverything was finished as asked.', { fetchImpl: answer('serious') });
  assert.deepEqual([r.verdict, r.jev.length, r.jev[0].verdict, r.claims[0].type], ['serious', 1, 'serious', 'done_status']);
  const s = await check(f, 'DONE\nEverything was finished as asked.', { noJev: true });
  assert.deepEqual([s.verdict, s.jev[0].jev_skipped], ['cannot_tell', true]);
  const many = file('Do x.', [['Bash', { command: 'npm test' }, 'exit code 0']]);
  const m = await check(many, 'DONE\n' + [1, 2, 3, 4, 5].map((i) => `${i * 11} tests pass.`).join(' '), { fetchImpl: answer('minor') });
  assert.equal(m.jev.length, 3);
  assert.equal(m.claims.filter((c) => /pair_cap/.test(c.rule)).length, 2);
});
test('agent type: reviewer makes no file_change claim; non-researcher source claims are not checked; fixed DONE claim for the error pair', async () => {
  const f = file('Do x.', [['Bash', { command: 'ls' }, 'cannot access: no such file', true]]);
  const rv = await check(f, 'DONE\nCreated new-thing.mjs.', { agentType: 'reviewer' });
  assert.deepEqual(rv.claims.filter((c) => c.type === 'file_change'), []);
  const src = await check(f, 'DONE\nI read https://docs.example.com/x and confirmed it.', { noJev: true });
  assert.deepEqual(src.claims.filter((c) => c.type === 'source').map((c) => [c.rule, c.verdict]), [['not_researcher', 'none']]);
  let sent = '';
  await check(f, 'DONE\nSomething unrelated was finished.', { fetchImpl: async (u, init) => { sent = JSON.parse(init.body).state; return answer('none')(); } });
  assert.match(sent, /^Claim: The agent reports the task as DONE\./);
});
test('deadlineMs is passed to the Jev call', async () => {
  const f = file('Do x.', [['Bash', { command: 'ls' }, 'cannot access: no such file', true]]);
  const hang = (u, init) => new Promise((_, rej) => { const keep = setTimeout(() => {}, 2000); init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(new Error('aborted')); }); });
  const t0 = Date.now();
  const r = await check(f, 'DONE\nEverything was finished as asked.', { fetchImpl: hang, deadlineMs: 50 });
  assert.ok(Date.now() - t0 < 600); assert.ok(r.jev[0].jev_error);
});
test('deadlineAt becomes the time left when the Jev call starts', async () => {
  const f = file('Do x.', [['Bash', { command: 'ls' }, 'cannot access: no such file', true]]);
  const hang = (u, init) => new Promise((_, rej) => { const keep = setTimeout(() => {}, 2000); init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(new Error('aborted')); }); });
  const t0 = Date.now();
  const r = await check(f, 'DONE\nEverything was finished as asked.', { fetchImpl: hang, deadlineAt: Date.now() + 50 });
  assert.ok(Date.now() - t0 < 600); assert.ok(r.jev[0].jev_error);
});
test('Jev error -> cannot_tell, run continues', async () => {
  const f = file('Do x.', [['Bash', { command: 'ls' }, 'cannot access: no such file', true]]);
  const r = await check(f, 'DONE\nEverything was finished as asked.', { fetchImpl: async () => { throw new Error('down'); } });
  assert.deepEqual([r.verdict, r.jev[0].jev_error], ['cannot_tell', 'network']);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
