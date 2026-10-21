// Direct tests of onDispatch with injected priors. The full hook flow (35 relocated tests) lives in agent-hooks.test.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onDispatch } from './dispatch-guard.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const answer = (p2) => ({ type: 'score', score: 2 * p2, confidence: p2, legend: ['a', 'b', 'c'], probabilities: { 0: (1 - p2) / 2, 1: (1 - p2) / 2, 2: p2 } });
const fixed = (p2) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); return new Response(JSON.stringify({ model: 'm', answers: { same_task: answer(p2) } }), { status: 200 }); }; f.calls = 0; return f; };
const tmp = () => mkdtempSync(join(tmpdir(), 'dgu-test-'));
const lines = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const input = (prompt, id = 'tNew') => ({ session_id: 's1', tool_use_id: id, tool_input: { description: 'd', prompt, subagent_type: 'worker' } });
const prior = (over) => ({ tool_use_id: 'tOld', status: 'DONE', agent_id: 'a1', ts: new Date().toISOString(), description: 'old', subagent_type: 'worker', ...over });
const A = 'Summary: Audit the billing module for dead code\nplease go through every file in the billing module and list dead code with reasons';
const B = 'Summary: Find unused code in billing\nplease go through every file in the billing module and list unused code with reasons';
const norm = (p) => p.trim().replace(/\s+/g, ' ').toLowerCase();
const { createHash } = await import('node:crypto');
const sha = (p) => createHash('sha256').update(norm(p)).digest('hex');

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('exact match -> same_as in record and registry event; output is an object only in deny mode', async () => {
  const dir = tmp();
  const { output, record, event } = await onDispatch(input('do the thing'), { dir, priors: [prior({ prompt_sha256: sha('do the thing'), prompt: 'do the thing' })] });
  assert.equal(output, null); assert.deepEqual([record.same_as, record.kind, record.verdict], ['tOld', 'duplicate_exact', 'would_deny']);
  assert.equal(event.same_as, 'tOld'); assert.equal(event.event, 'dispatch'); assert.equal(event.prompt, 'do the thing'); assert.equal(event.prompt_sha256, sha('do the thing')); assert.equal(lines(dir, 'registry.jsonl').length, 0, 'the entry appends the event'); assert.equal(lines(dir, 'dispatch-guard.jsonl')[0].same_as, 'tOld');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ dispatchGuard: { mode: 'deny' } }));
  const d = await onDispatch(input('do the thing'), { dir, priors: [prior({ prompt_sha256: sha('do the thing'), prompt: 'do the thing' })] });
  assert.equal(d.output.hookSpecificOutput.permissionDecision, 'deny');
});
test('near match: same_as only when Jev says yes', async () => {
  const p = prior({ prompt: norm(A), summary: 'Audit the billing module for dead code', status: 'running' });
  assert.equal((await onDispatch(input(B), { dir: tmp(), priors: [p], fetchImpl: fixed(0.95) })).record.same_as, 'tOld');
  assert.equal((await onDispatch(input(B), { dir: tmp(), priors: [p], fetchImpl: fixed(0.1) })).record.same_as, null);
});
test('Repeat: marker -> intended_repeat, pass, no Jev call, even for an exact duplicate', async () => {
  const f = fixed(0.95);
  const r = await onDispatch(input(B + '\nrepeat: A/B arm 2'), { dir: tmp(), priors: [prior({ prompt: norm(A), summary: 'Audit the billing module for dead code' })], fetchImpl: f });
  assert.deepEqual([r.record.kind, r.record.verdict, r.record.jev_p_yes], ['intended_repeat', 'pass', null]); assert.equal(f.calls, 0);
  const e = await onDispatch(input('do the thing\nRepeat: calibration'), { dir: tmp(), priors: [prior({ prompt_sha256: sha('do the thing\nRepeat: calibration'), prompt: 'x' })], fetchImpl: f });
  assert.deepEqual([e.record.kind, e.record.verdict], ['intended_repeat', 'pass']);
});
test('score threshold on probabilities["2"]: 0.86 -> would_deny, 0.84 -> pass; logs score fields', async () => {
  const p = prior({ prompt: norm(A), summary: 'Audit the billing module for dead code', status: 'running' });
  const hi = await onDispatch(input(B), { dir: tmp(), priors: [p], fetchImpl: fixed(0.86) });
  assert.deepEqual([hi.record.verdict, hi.record.kind, hi.record.jev_p_yes, hi.record.jev_score], ['would_deny', 'duplicate_semantic', 0.86, 1.72]);
  const f = fixed(0.84); const lo = await onDispatch(input(B), { dir: tmp(), priors: [p], fetchImpl: f });
  assert.deepEqual([lo.record.verdict, lo.record.same_as, lo.record.jev_p_yes], ['pass', null, 0.84]);
  assert.deepEqual(f.last.state, { task_a: 'Audit the billing module for dead code', task_b: 'Find unused code in billing' });
  assert.equal(f.last.questions.same_task.type, 'score'); assert.equal(f.last.questions.same_task.criteria.length, 3);
});
test('unknown prior: at most would_flag, exact or semantic', async () => {
  const p = prior({ prompt: norm(A), prompt_sha256: sha(A), summary: 'Audit the billing module for dead code', status: 'unknown' });
  assert.equal((await onDispatch(input(B), { dir: tmp(), priors: [p], fetchImpl: fixed(0.95) })).record.verdict, 'would_flag');
  assert.equal((await onDispatch(input(A), { dir: tmp(), priors: [p] })).record.verdict, 'would_flag');
});
test('no priors -> same_as null; rerun keeps the verdict and finds same_as locally', async () => {
  assert.equal((await onDispatch(input('x'), { dir: tmp(), priors: [] })).record.same_as, null);
  const r = await onDispatch(input(B + '\nRerun: lost'), { dir: tmp(), priors: [prior({ prompt: norm(A) })], fetchImpl: async () => { throw new Error('no fetch'); } });
  assert.deepEqual([r.record.verdict, r.record.same_as, r.record.jev_error], ['rerun_override', 'tOld', null]);
});
test('no prompt -> nothing recorded', async () => {
  const dir = tmp(); assert.deepEqual(await onDispatch({ tool_input: {} }, { dir, priors: [] }), { output: null, record: null, event: null }); assert.equal(lines(dir, 'registry.jsonl').length, 0);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
