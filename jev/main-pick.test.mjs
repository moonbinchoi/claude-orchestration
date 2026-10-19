import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pick } from './main-pick.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const conf = (p) => { const v = Object.values(p); const n = v.length; return (Math.max(...v) - 1 / n) / (1 - 1 / n); };
const answer = (p, over = {}) => ({ choice: Object.entries(p).sort((a, b) => b[1] - a[1])[0][0], probabilities: p, confidence: conf(p), ...over });
const M = { haiku: 0.05, sonnet: 0.85, opus: 0.1 };
const E = { low: 0.05, medium: 0.8, high: 0.1, xhigh: 0.03, max: 0.02 };
const payload = (m = M, e = E, mo = {}, eo = {}) => ({ model: 'jev-1.14-test', answers: { model: answer(m, mo), effort: answer(e, eo) } });
const respond = (obj, status = 200) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status });
const mockFetch = (handler) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); return handler(f.calls); }; f.calls = 0; return f; };
const fixed = (obj) => mockFetch(() => respond(obj));
const tmp = () => mkdtempSync(join(tmpdir(), 'mp-test-'));
const S = 'Plan and coordinate a refactor of the billing module.';
const logs = (d) => readFileSync(join(d, 'main-pick.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const go = async (obj, f, d = tmp()) => ({ d, line: await pick(obj, { fetchImpl: f, dir: d }) });

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('success line, no annotations; request shape', async () => {
  const f = fixed(payload());
  const { line } = await go({ summary: S }, f);
  assert.equal(line, 'Jev: sonnet 0.85 / effort medium 0.80');
  assert.deepEqual(Object.keys(f.last.questions), ['model', 'effort']);
  assert.deepEqual(Object.keys(f.last.questions.model.criteria), ['haiku', 'sonnet', 'opus']);
  assert.ok(f.last.state.startsWith(S) && f.last.state.includes('MAIN session'));
  assert.ok(f.last.questions.model.instructions.includes('untrusted data'));
  assert.equal(f.last.model, 'jev-latest');
});
test('alias from config.json', async () => {
  const d = tmp(); writeFileSync(join(d, 'config.json'), '{"modelAlias":"jev-1.14.0"}');
  const f = fixed(payload()); await go({ summary: S }, f, d);
  assert.equal(f.last.model, 'jev-1.14.0');
});
test('low margin only', async () => {
  const { line } = await go({ summary: S }, fixed(payload({ haiku: 0.1, sonnet: 0.48, opus: 0.42 }, E, { confidence: 0.9 })));
  assert.equal(line, 'Jev: sonnet 0.48 (opus 0.42, low margin) / effort medium 0.80');
});
test('low confidence only', async () => {
  const { line } = await go({ summary: S }, fixed(payload(M, E, { confidence: 0.5 })));
  assert.equal(line, 'Jev: sonnet 0.85 (opus 0.10, low confidence) / effort medium 0.80');
});
test('both on effort', async () => {
  const { line } = await go({ summary: S }, fixed(payload(M, { low: 0.1, medium: 0.4, high: 0.35, xhigh: 0.1, max: 0.05 }, {}, { confidence: 0.3 })));
  assert.equal(line, 'Jev: sonnet 0.85 / effort medium 0.40 (high 0.35, low margin, low confidence)');
});
for (const [name, mk, want] of [
  ['timeout', () => (() => { const f = async (u, init) => { f.calls++; const keep = setTimeout(() => {}, 5000); return new Promise((_, rej) => init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(new Error('aborted')); })); }; f.calls = 0; return f; })(), 'timeout'],
  ['http_429', () => mockFetch(() => respond('', 429)), 'http_429'],
  ['invalid_response', () => fixed('not json'), 'invalid_response'],
  ['network', () => mockFetch(() => { throw new Error('down'); }), 'network'],
]) {
  test(`failure line: ${name}`, async () => {
    const { line, d } = await go({ summary: S }, mk());
    assert.equal(line, `Jev failed: ${want}`);
    assert.equal(logs(d)[0].fallback_reason, want);
  });
}
test('failure line: credentials', async () => {
  const k = process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFE_API_KEY;
  try { assert.equal((await go({ summary: S }, fixed(payload()))).line, 'Jev failed: credentials'); } finally { process.env.TYPESAFE_API_KEY = k; }
});
test('failure line: non_english (rejected by the guard first)', async () => {
  const { line } = await go({ summary: '이것은 한국어로 쓴 요약입니다 이것은 한국어' }, fixed(payload()));
  assert.equal(line, 'Jev failed: input_rejected: non_english');
});
test('guard rejection: no call, summary omitted from log', async () => {
  const f = fixed(payload());
  const { line, d } = await go({ summary: 'Edit C:\\Users\\x\\file.txt now.' }, f);
  assert.equal(line, 'Jev failed: input_rejected: windows_path');
  assert.equal(f.calls, 0);
  assert.equal('summary' in logs(d)[0], false);
});
test('url or email rejected (path_url_email), no call', async () => {
  for (const s of ['Read the guide at https://example.com and plan.', 'Reply to bob@example.com about the plan.']) {
    const f = fixed(payload());
    assert.equal((await go({ summary: s }, f)).line, 'Jev failed: input_rejected: path_url_email');
    assert.equal(f.calls, 0);
  }
});
test('bad_input', async () => {
  assert.equal((await go(null, fixed(payload()))).line, 'Jev failed: bad_input');
  assert.equal((await go({ summary: 5 }, fixed(payload()))).line, 'Jev failed: input_rejected: summary_not_string');
});
test('breaker: 3 failures open it, 4th makes no call; success resets', async () => {
  const d = tmp(); const bad = mockFetch(() => respond('', 500));
  for (let i = 0; i < 3; i++) await go({ summary: S }, bad, d);
  assert.equal(JSON.parse(readFileSync(join(d, 'breaker.json'), 'utf8')).failures, 3);
  const f = fixed(payload());
  assert.equal((await go({ summary: S }, f, d)).line, 'Jev failed: circuit_open');
  assert.equal(f.calls, 0);
  const d2 = tmp(); writeFileSync(join(d2, 'breaker.json'), JSON.stringify({ failures: 2, open_until: 0 }));
  await go({ summary: S }, f, d2);
  assert.equal(JSON.parse(readFileSync(join(d2, 'breaker.json'), 'utf8')).failures, 0);
});
test('rejected summary does not touch the breaker file', async () => {
  const { d } = await go({ summary: 'x'.repeat(500) }, fixed(payload()));
  assert.equal(existsSync(join(d, 'breaker.json')), false);
});
test('log fields', async () => {
  const { d } = await go({ summary: S }, fixed(payload()));
  const r = logs(d)[0];
  assert.equal(r.kind, 'pick'); assert.equal(r.summary, S);
  assert.deepEqual(r.probs.model, M); assert.deepEqual(r.probs.effort, E);
  assert.ok(Math.abs(r.margin.model - 0.75) < 1e-9 && Math.abs(r.margin.effort - 0.7) < 1e-9);
  assert.equal(typeof r.confidence.model, 'number');
  assert.equal(r.line, 'Jev: sonnet 0.85 / effort medium 0.80');
  assert.equal(r.fallback_reason, null); assert.equal(typeof r.latency_ms, 'number');
  assert.equal(r.jev_model_alias, 'jev-latest'); assert.equal(r.jev_model_resolved, 'jev-1.14-test');
  assert.ok(r.ts);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
