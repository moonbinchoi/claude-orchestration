import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onStop } from './report-guard.mjs';
import { transcript as fixture } from './report-fixtures.mjs';
import { readTail } from './transcript-read.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const setup = (cfg) => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-test-'));
  if (cfg) writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  const t = join(dir, 't.jsonl');
  writeFileSync(t, fixture('Do x.', []));
  return { dir, transcript: readTail(t), input: { session_id: 's', agent_id: 'a', agent_type: 'worker', agent_transcript_path: t } };
};
const log = (dir) => readFileSync(join(dir, 'report-guard.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const text = 'DONE\nAll 3 tests pass.';
const calls = [];
const fetchImpl = async (u, init) => {
  calls.push(1);
  const q = Object.keys(JSON.parse(init.body).questions)[0];
  return new Response(JSON.stringify({ model: 'm', answers: { [q]: { choice: 'none', probabilities: { none: 0.97, minor: 0.01, serious: 0.01, cannot_tell: 0.01 }, confidence: 0.96 } } }));
};

test('default mode log: one record with the full shape, nothing returned', async () => {
  const { dir, input, transcript } = setup();
  assert.equal(await onStop(input, { text, status: 'DONE', transcript, dir, fetchImpl, random: () => 1 }), undefined);
  const [r] = log(dir);
  assert.deepEqual(Object.keys(r).sort(), ['agent_id', 'agent_type', 'claims', 'jev', 'jev_report', 'mode', 'session_id', 'skipped', 'status', 'transcript_bytes', 'truncated', 'ts', 'unextracted_sample', 'verdict'].sort());
  assert.deepEqual([r.mode, r.verdict, r.claims[0].type, r.session_id, r.agent_type], ['log', 'serious', 'test_pass', 's', 'worker']);
});
test('off writes nothing; enforce logs like log; bad mode falls back to log', async () => {
  const off = setup({ reportGuard: { mode: 'off' } });
  await onStop(off.input, { text, status: 'DONE', transcript: off.transcript, dir: off.dir });
  assert.equal(existsSync(join(off.dir, 'report-guard.jsonl')), false);
  const enf = setup({ reportGuard: { mode: 'enforce' } });
  assert.equal(await onStop(enf.input, { text, status: 'DONE', transcript: enf.transcript, dir: enf.dir, fetchImpl, random: () => 1 }), undefined);
  assert.equal(log(enf.dir)[0].mode, 'enforce');
  const bad = setup({ reportGuard: { mode: 'nope' } });
  await onStop(bad.input, { text, status: 'DONE', transcript: bad.transcript, dir: bad.dir, fetchImpl, random: () => 1 });
  assert.equal(log(bad.dir)[0].mode, 'log');
});
test('skipped report still logs a record with skipped', async () => {
  const { dir, input, transcript } = setup();
  await onStop(input, { text: 'BLOCKED\nno', status: 'BLOCKED', dir });
  assert.equal(log(dir)[0].skipped, 'status');
});

test('jevShadow defaults on; false gives the old record shape and no Jev call', async () => {
  const on = setup();
  calls.length = 0;
  await onStop(on.input, { text, status: 'DONE', transcript: on.transcript, dir: on.dir, fetchImpl, random: () => 1 });
  assert.deepEqual([calls.length, log(on.dir)[0].claims[0].jev_shadow.verdict, log(on.dir)[0].claims[0].verdict], [2, 'none', 'serious']);
  const off = setup({ reportGuard: { jevShadow: false } });
  calls.length = 0;
  await onStop(off.input, { text, status: 'DONE', transcript: off.transcript, dir: off.dir, fetchImpl, random: () => 1 });
  const r = log(off.dir)[0];
  assert.deepEqual([calls.length, 'jev_report' in r, 'jev_shadow' in r.claims[0]], [0, false, false]);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
