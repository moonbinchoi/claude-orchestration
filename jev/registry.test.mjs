import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append, readRegistry } from './registry.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'rg-test-'));
const now = Date.now();
const ts = new Date(now).toISOString();
const D = { ts, event: 'dispatch', session_id: 's1', tool_use_id: 't1', prompt: 'p', same_as: 'tPrev' };
const L = { ts, event: 'link', session_id: 's1', tool_use_id: 't1', agent_id: 'a1', resolved_model: 'm', launch_status: 'completed' };
const S = { ts, event: 'stop', session_id: 's1', agent_id: 'a1', status: 'BLOCKED', failure: { subkind: null } };
const V = (verdict) => ({ ts, event: 'retry_verdict', session_id: 's1', tool_use_id: 't1', class: 'new_cause', subkind: null, verdict });

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const fold = (events, sid = 's1', at = now) => { const dir = tmp(); for (const e of events) append(dir, 'registry.jsonl', e); return readRegistry(dir, at, sid); };

test('append writes jsonl; unwritable dir never throws', () => {
  const dir = tmp(); append(dir, 'x.jsonl', { a: 1 }); assert.equal(readFileSync(join(dir, 'x.jsonl'), 'utf8'), '{"a":1}\n');
  append(join(dir, 'nope', 'sub'), 'x.jsonl', { a: 1 });
});
test('fold fields and defaults', () => {
  const [d] = fold([D]);
  assert.deepEqual([d.status, d.agent_id, d.resolved_model, d.launch_status, d.failure, d.verdict, d.same_as], ['running', null, null, null, null, null, 'tPrev']);
  assert.equal(fold([{ ...D, same_as: undefined }])[0].same_as, null);
});
test('fold is order independent for link and stop', () => {
  const a = fold([D, L, S])[0], b = fold([D, S, L])[0];
  assert.deepEqual(a, b); assert.deepEqual([a.status, a.agent_id, a.launch_status, a.failure], ['BLOCKED', 'a1', 'completed', { subkind: null }]);
});
test('stop failure preferred over link failure; link failure used when stop has none', () => {
  const lf = { ...L, failure: { subkind: 'auth' } };
  assert.equal(fold([D, lf, S])[0].failure.subkind, null);
  assert.equal(fold([D, lf, { ...S, status: 'DONE', failure: null }])[0].failure.subkind, 'auth');
  assert.equal(fold([D, { ...S, status: 'DONE', failure: null }, lf])[0].failure.subkind, 'auth');
});
test('latest retry_verdict wins', () => {
  const d = fold([D, L, V('would_flag'), V('pass')])[0];
  assert.equal(d.verdict.verdict, 'pass'); assert.equal(d.verdict.class, 'new_cause');
});
test('session filter, 7-day window and garbage lines', () => {
  assert.deepEqual(fold([D], 's2'), []);
  assert.deepEqual(fold([{ ...D, ts: new Date(now - 8 * 24 * 3600 * 1000).toISOString() }]), []);
  const dir = tmp(); writeFileSync(join(dir, 'registry.jsonl'), 'garbage{\n' + JSON.stringify(D) + '\n');
  assert.equal(readRegistry(dir, now, 's1').length, 1);
  assert.deepEqual(readRegistry(join(dir, 'missing'), now, 's1'), []);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
