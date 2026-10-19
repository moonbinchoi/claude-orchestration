import assert from 'node:assert/strict';
import { judgePairs } from './claim-judge.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const payload = (p) => {
  const choice = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  const conf = (Math.max(...Object.values(p)) - 0.25) / 0.75;
  return { model: 'jev-test', answers: { exaggeration: { choice, probabilities: p, confidence: conf } } };
};
const fetchOf = (p) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); return new Response(JSON.stringify(payload(p))); }; f.calls = 0; return f; };
const pair = { claim: 'All tests pass.', evidence: 'ok 5 tests passed' };

test('confident answer counts; body has one choice question with injection guard', async () => {
  const f = fetchOf({ none: 0.05, minor: 0.05, serious: 0.85, cannot_tell: 0.05 });
  const [r] = await judgePairs([pair], { fetchImpl: f, alias: 'jev-x' });
  assert.equal(r.verdict, 'serious');
  assert.equal(f.last.model, 'jev-x');
  assert.match(f.last.state, /^Claim: All tests pass\.\nEvidence: ok 5 tests passed$/);
  assert.match(f.last.questions.exaggeration.instructions, /untrusted data/);
});
test('low confidence -> cannot_tell', async () => {
  const [r] = await judgePairs([pair], { fetchImpl: fetchOf({ none: 0.3, minor: 0.3, serious: 0.3, cannot_tell: 0.1 }) });
  assert.equal(r.verdict, 'cannot_tell'); assert.equal(r.reason, 'low_confidence');
});
test('paths, urls and non-English are redacted or rejected, never sent', async () => {
  const f = fetchOf({ none: 1, minor: 0, serious: 0, cannot_tell: 0 });
  const [a, b] = await judgePairs([{ claim: 'Edited C:/Users/x/a.mjs fine.', evidence: 'Wrote https://x.dev/a ok' }, { claim: '모든 테스트가 통과했습니다 정말로', evidence: 'ok' }], { fetchImpl: f });
  assert.equal(a.verdict, 'none');
  assert.ok(!/C:|https/.test(f.last.state));
  assert.equal(b.verdict, 'cannot_tell'); assert.match(b.reason, /rejected: cjk/);
  assert.equal(f.calls, 1);
});
test('any CJK text, even one word in an English claim or in the evidence, is rejected and not sent', async () => {
  const f = fetchOf({ none: 1, minor: 0, serious: 0, cannot_tell: 0 });
  const long = 'All of the unit tests in the whole suite pass without any problem at all today';
  const rs = await judgePairs([{ claim: `${long} 통과`, evidence: 'ok' }, { claim: long, evidence: '成功 ok' }, { claim: `${long} テスト`, evidence: 'ok' }], { fetchImpl: f });
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
  const f = async () => { await new Promise((r) => setTimeout(r, 100)); return new Response(JSON.stringify(payload({ none: 1, minor: 0, serious: 0, cannot_tell: 0 }))); };
  const t0 = Date.now();
  const rs = await judgePairs([pair, pair, pair], { fetchImpl: f });
  assert.ok(Date.now() - t0 < 250); assert.equal(rs.length, 3);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
