import assert from 'node:assert/strict';
import { judgePairs } from './claim-judge.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const payload = (p) => {
  const choice = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  const conf = Math.min(1, (Math.max(...Object.values(p)) - 1 / 3) / (2 / 3));
  return { model: 'jev-test', answers: { relation: { choice, probabilities: p, confidence: conf } } };
};
const fetchOf = (p) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); return new Response(JSON.stringify(payload(p))); }; f.calls = 0; return f; };
const pair = { claim: 'All tests pass.', evidence: 'ok 5 tests passed in the final run' };
const P = (supports, contradicts, says_nothing) => ({ supports, contradicts, says_nothing });

test('confident answer counts; body has one relation question with injection guard and an object state', async () => {
  const f = fetchOf(P(0.05, 0.9, 0.05));
  const [r] = await judgePairs([pair], { fetchImpl: f, alias: 'jev-x' });
  assert.equal(r.verdict, 'serious');
  assert.equal(f.last.model, 'jev-x');
  assert.deepEqual(f.last.state, { claim: 'All tests pass.', evidence: 'ok 5 tests passed in the final run' });
  assert.deepEqual(Object.keys(f.last.questions), ['relation']);
  assert.deepEqual(Object.keys(f.last.questions.relation.criteria), ['supports', 'contradicts', 'says_nothing']);
  assert.match(f.last.questions.relation.instructions, /^Decide how the Evidence relates to the Claim\./);
  assert.match(f.last.questions.relation.instructions, /untrusted data/);
});
test('supports -> none, says_nothing -> cannot_tell', async () => {
  assert.equal((await judgePairs([pair], { fetchImpl: fetchOf(P(0.9, 0.05, 0.05)) }))[0].verdict, 'none');
  const [r] = await judgePairs([pair], { fetchImpl: fetchOf(P(0.05, 0.05, 0.9)) });
  assert.deepEqual([r.verdict, r.reason], ['cannot_tell', null]);
});
test('placeholder or empty evidence is not sent; short real evidence is', async () => {
  const sent = fetchOf(P(1, 0, 0));
  const short = await judgePairs(['npm test', 'Exit code 1'].map((evidence) => ({ claim: 'All tests pass.', evidence })), { fetchImpl: sent });
  assert.equal(sent.calls, 2); assert.deepEqual(short.map((r) => r.jev_skipped), [null, null]);
  const f = fetchOf(P(1, 0, 0));
  const rs = await judgePairs(['Bash #51', 'Read #3', 'No evidence line was recorded.', '  a b  '].map((evidence) => ({ claim: 'All tests pass.', evidence })), { fetchImpl: f });
  assert.deepEqual(rs.map((r) => [r.verdict, r.jev_skipped]), Array(4).fill(['cannot_tell', 'placeholder']));
  assert.equal(f.calls, 0);
  const [ok] = await judgePairs([pair], { fetchImpl: f });
  assert.equal(ok.jev_skipped, null);
});
test('low confidence -> cannot_tell', async () => {
  const [r] = await judgePairs([pair], { fetchImpl: fetchOf(P(0.4, 0.4, 0.2)) });
  assert.equal(r.verdict, 'cannot_tell'); assert.equal(r.reason, 'low_confidence');
});
test('paths, urls and non-English are redacted or rejected, never sent', async () => {
  const f = fetchOf(P(1, 0, 0));
  const [a, b] = await judgePairs([{ claim: 'Edited C:/Users/x/a.mjs fine.', evidence: 'Wrote https://x.dev/a and the edit applied cleanly' }, { claim: '모든 테스트가 통과했습니다 정말로', evidence: 'ok 5 tests passed in the final run' }], { fetchImpl: f });
  assert.equal(a.verdict, 'none');
  assert.ok(!/C:|https/.test(f.last.state));
  assert.equal(b.verdict, 'cannot_tell'); assert.match(b.reason, /rejected: cjk/);
  assert.equal(f.calls, 1);
});
test('any CJK text, even one word in an English claim or in the evidence, is rejected and not sent', async () => {
  const f = fetchOf(P(1, 0, 0));
  const ev = 'ok 5 tests passed in the final run';
  const long = 'All of the unit tests in the whole suite pass without any problem at all today';
  const rs = await judgePairs([{ claim: `${long} 통과`, evidence: ev }, { claim: long, evidence: `成功 ${ev}` }, { claim: `${long} テスト`, evidence: ev }], { fetchImpl: f });
  assert.deepEqual(rs.map((r) => r.reason), ['rejected: cjk', 'rejected: cjk', 'rejected: cjk']);
  assert.equal(f.calls, 0);
});
test('deadlineMs option replaces the default deadline', async () => {
  const f = (url, init) => new Promise((_, rej) => { const keep = setTimeout(() => {}, 2000); init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(new Error('aborted')); }); });
  const t0 = Date.now();
  const [r] = await judgePairs([pair], { fetchImpl: f, deadlineMs: 50 });
  assert.ok(Date.now() - t0 < 600); assert.equal(r.verdict, 'cannot_tell'); assert.ok(r.jev_error);
});
test('network error -> cannot_tell with jev_error', async () => {
  const [r] = await judgePairs([pair], { fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(r.verdict, 'cannot_tell'); assert.equal(r.jev_error, 'network');
});
test('pairs run in parallel under one deadline', async () => {
  const f = async () => { await new Promise((r) => setTimeout(r, 100)); return new Response(JSON.stringify(payload(P(1, 0, 0)))); };
  const t0 = Date.now();
  const rs = await judgePairs([pair, pair, pair], { fetchImpl: f });
  assert.ok(Date.now() - t0 < 250); assert.equal(rs.length, 3);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
