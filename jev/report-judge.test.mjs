import assert from 'node:assert/strict';
import { judgeReport } from './report-judge.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const fetchOf = (choice, conf) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); const p = Object.fromEntries(['none', 'minor', 'serious', 'cannot_tell'].map((k) => [k, k === choice ? 0.7 : 0.1])); return new Response(JSON.stringify({ model: 'm', answers: { overreach: { choice, probabilities: p, confidence: conf } } })); }; f.calls = 0; return f; };
const sel = { sentences: ['All tests pass.', 'Nothing was skipped.'], dropped: 2 };

test('sends requirement from the Summary line and the sentences; confident answer counts', async () => {
  const f = fetchOf('serious', 0.9);
  const r = await judgeReport(sel, 'Summary: Fix the parser bug.\nGoal: x', { fetchImpl: f });
  assert.equal(f.last.state, 'Requirement: Fix the parser bug.\nReport sentences:\n- All tests pass.\n- Nothing was skipped.');
  assert.match(f.last.questions.overreach.instructions, /untrusted data/);
  assert.deepEqual([r.verdict, r.sentences_sent, r.dropped, r.requirement_sent, r.jev_error], ['serious', 2, 2, true, null]);
  assert.equal(r.p.serious, 0.7);
});
test('missing or rejected requirement -> (none); Summary must be the first line', async () => {
  const f = fetchOf('none', 0.9);
  assert.equal((await judgeReport(sel, 'Goal: x\nSummary: late', { fetchImpl: f })).requirement_sent, false);
  assert.match(f.last.state, /^Requirement: \(none\)\n/);
  assert.equal((await judgeReport(sel, 'Summary: Fix 파서 bug now', { fetchImpl: f })).requirement_sent, false);
  assert.equal((await judgeReport(sel, null, { fetchImpl: f })).requirement_sent, false);
});
test('low confidence -> cannot_tell; no sentences -> not sent', async () => {
  const f = fetchOf('serious', 0.3);
  const r = await judgeReport(sel, null, { fetchImpl: f });
  assert.deepEqual([r.verdict, r.reason], ['cannot_tell', 'low_confidence']);
  f.calls = 0;
  const n = await judgeReport({ sentences: [], dropped: 1 }, null, { fetchImpl: f });
  assert.deepEqual([n.reason, n.dropped, f.calls], ['no_sentences', 1, 0]);
});
test('http error is logged, never thrown', async () => {
  const r = await judgeReport(sel, null, { fetchImpl: async () => new Response('x', { status: 500 }) });
  assert.deepEqual([r.verdict, r.jev_error], ['cannot_tell', 'http_500']);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
