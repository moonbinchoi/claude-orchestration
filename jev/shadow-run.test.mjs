import assert from 'node:assert/strict';
import { runShadow, MAX_CALLS } from './shadow-run.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const fetchOf = (choice) => { const f = async (url, init) => { f.calls++; const q = Object.keys(JSON.parse(init.body).questions)[0]; const p = Object.fromEntries(['supports', 'contradicts', 'says_nothing'].map((k) => [k, k === choice ? 0.97 : 0.015])); return new Response(JSON.stringify({ model: 'm', answers: { [q]: { choice, probabilities: p, confidence: 0.96 } } })); }; f.calls = 0; return f; };
const items = (n) => Array.from({ length: n }, (_, i) => ({ claim: { original: `Claim ${i} done.` }, result: { rule: 'run_matches', evidence: `ok, all ${i} checks ran fine` } }));
const base = { alias: 'jev-x', now: Date.now, deadlineMs: 1500, capped: false };

test('one call per claim; shadows aligned with items', async () => {
  const f = fetchOf('contradicts');
  const r = await runShadow({ ...base, items: items(2), used: 0, fetchImpl: f });
  assert.equal(f.calls, 2);
  assert.deepEqual(r.shadows.map((s) => s.verdict), ['serious', 'serious']);
  assert.deepEqual(Object.keys(r.shadows[0]).sort(), ['confidence', 'jev_error', 'jev_skipped', 'latency_ms', 'p', 'reason', 'verdict']);
});
test('budget: existing pairs first, then claims; the rest log budget_cap', async () => {
  const f = fetchOf('supports');
  const r = await runShadow({ ...base, items: items(10), used: 3, fetchImpl: f });
  assert.equal(f.calls + 3, MAX_CALLS);
  assert.deepEqual(r.shadows.map((s) => s.reason), [null, null, null, null, null, 'budget_cap', 'budget_cap', 'budget_cap', 'budget_cap', 'budget_cap']);
});
test('a deadline cut is logged as deadline', async () => {
  const hang = (u, init) => new Promise((_, rej) => { const keep = setTimeout(() => {}, 2000); init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(new Error('aborted')); }); });
  const r = await runShadow({ ...base, items: items(1), used: 0, fetchImpl: hang, deadlineMs: 30, capped: true });
  assert.equal(r.shadows[0].jev_error, 'deadline');
});
test('a rejected claim pair is logged with the reason and not sent', async () => {
  const f = fetchOf('supports');
  const bad = [{ claim: { original: '모든 테스트가 통과했습니다 정말로' }, result: { rule: 'run_matches', evidence: 'ok, all checks ran fine here' } }];
  const r = await runShadow({ ...base, items: bad, used: 0, fetchImpl: f });
  assert.equal(f.calls, 0);
  assert.match(r.shadows[0].reason, /rejected: cjk/);
});
test('placeholder evidence is not sent and logs jev_skipped', async () => {
  const f = fetchOf('supports');
  const r = await runShadow({ ...base, items: [{ claim: { original: 'Claim done.' }, result: { rule: 'run_matches', evidence: 'Bash #51' } }], used: 0, fetchImpl: f });
  assert.deepEqual([f.calls, r.shadows[0].verdict, r.shadows[0].jev_skipped], [0, 'cannot_tell', 'placeholder']);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
