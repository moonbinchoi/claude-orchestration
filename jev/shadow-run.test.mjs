import assert from 'node:assert/strict';
import { runShadow, MAX_CALLS } from './shadow-run.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const fetchOf = (choice) => { const f = async (url, init) => { f.calls++; const q = Object.keys(JSON.parse(init.body).questions)[0]; const p = Object.fromEntries(['none', 'minor', 'serious', 'cannot_tell'].map((k) => [k, k === choice ? 0.97 : 0.01])); return new Response(JSON.stringify({ model: 'm', answers: { [q]: { choice, probabilities: p, confidence: 0.96 } } })); }; f.calls = 0; return f; };
const items = (n) => Array.from({ length: n }, (_, i) => ({ claim: { original: `Claim ${i} done.` }, result: { rule: 'run_matches', evidence: `ok ${i}` } }));
const base = { text: 'DONE\nAll tests pass.', brief: 'Summary: Do x.', alias: 'jev-x', now: Date.now, deadlineMs: 1500, capped: false };

test('one call per claim plus one report call; shadows aligned with items', async () => {
  const f = fetchOf('minor');
  const r = await runShadow({ ...base, items: items(2), used: 0, fetchImpl: f });
  assert.equal(f.calls, 3);
  assert.deepEqual(r.shadows.map((s) => s.verdict), ['minor', 'minor']);
  assert.deepEqual(Object.keys(r.shadows[0]).sort(), ['confidence', 'jev_error', 'latency_ms', 'p', 'reason', 'verdict']);
  assert.equal(r.jev_report.verdict, 'minor');
});
test('budget: existing pairs first, then the report call, then claims; the rest log budget_cap', async () => {
  const f = fetchOf('none');
  const r = await runShadow({ ...base, items: items(10), used: 3, fetchImpl: f });
  assert.equal(f.calls + 3, MAX_CALLS);
  assert.deepEqual(r.shadows.map((s) => s.reason), [null, null, null, null, 'budget_cap', 'budget_cap', 'budget_cap', 'budget_cap', 'budget_cap', 'budget_cap']);
  const g = fetchOf('none');
  await runShadow({ ...base, text: 'DONE\nThe sky is blue.', items: items(10), used: 3, fetchImpl: g });
  assert.equal(g.calls, 5);
});
test('a deadline cut is logged as deadline', async () => {
  const hang = (u, init) => new Promise((_, rej) => { const keep = setTimeout(() => {}, 2000); init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(new Error('aborted')); }); });
  const r = await runShadow({ ...base, items: items(1), used: 0, fetchImpl: hang, deadlineMs: 30, capped: true });
  assert.deepEqual([r.shadows[0].jev_error, r.jev_report.jev_error], ['deadline', 'deadline']);
});
test('a rejected claim pair is logged with the reason and not sent', async () => {
  const f = fetchOf('none');
  const bad = [{ claim: { original: '모든 테스트가 통과했습니다 정말로' }, result: { rule: 'run_matches', evidence: 'ok' } }];
  const r = await runShadow({ ...base, text: 'DONE\nThe sky is blue.', items: bad, used: 0, fetchImpl: f });
  assert.equal(f.calls, 0);
  assert.match(r.shadows[0].reason, /rejected: cjk/);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
