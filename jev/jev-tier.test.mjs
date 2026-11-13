import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, doctor, MODEL_Q } from './jev-tier.mjs';
import { assertEnglish, JevError, systemOne } from './jev-client.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const conf = (p) => { const v = Object.values(p); const n = v.length; return (Math.max(...v) - 1 / n) / (1 - 1 / n); };
const answer = (p, over = {}) => {
  const choice = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  return { choice, probabilities: p, confidence: conf(p), ...over };
};
const E = 2; // effort Score expected value -> 'high'
const effortAns = (score, over = {}) => ({ type: 'score', score, confidence: 0.5, legend: [], probabilities: { 0: 0.1, 1: 0.2, 2: 0.4, 3: 0.2, 4: 0.1 }, ...over });
const payload = (m, e = E, mo = {}, eo = {}) => ({
  model: 'jev-1.13-test',
  answers: { model: answer(m, mo), ...(e === null ? {} : { effort: effortAns(e, eo) }) },
  usage: { input_tokens: 10, output_tokens: 2 },
});
const respond = (obj, status = 200) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status });
const mockFetch = (handler) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); return handler(f.calls, init, f.last); }; f.calls = 0; return f; };
const fixed = (obj) => mockFetch(() => respond(obj));
const tmp = () => mkdtempSync(join(tmpdir(), 'jev-test-'));
const opts = (fetchImpl, extra = {}) => ({ fetchImpl, dir: tmp(), random: () => 0.99, ...extra });
const task = (summary = 'Fix a failing unit test in one module.', extra = {}) => ({ tasks: [{ id: 't1', summary, agent_type: 'worker', rule_model: 'sonnet', rule_effort: 'medium', ...extra }] });
const one = async (input, o) => (await run(input, o))[0];
const lines = (dir) => readFileSync(join(dir, 'shadow.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('argmax picks highest', async () => {
  const r = await one(task(), opts(fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }))));
  assert.equal(r.model, 'sonnet'); assert.equal(r.fallback_reason, null);
  assert.ok(Math.abs(r.margin - 0.75) < 1e-9);
});
test('confidence<floor steps up one rung, caps at opus', async () => {
  const r = await one(task(), opts(fixed(payload({ haiku: 0.8, sonnet: 0.1, opus: 0.1 }, E, { confidence: 0.3 }))));
  assert.equal(r.model, 'sonnet');
  const r2 = await one(task(), opts(fixed(payload({ haiku: 0.05, sonnet: 0.05, opus: 0.9 }, E, { confidence: 0.3 }))));
  assert.equal(r2.model, 'opus');
});
test('request body unchanged by this work unit', async () => {
  let sent;
  const f = mockFetch((_n, init) => { sent = init.body; return respond(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })); });
  const dir = tmp(); writeFileSync(join(dir, 'config.json'), '{"modelAlias":"jev-1.14.0"}');
  await one(task('Fix a failing unit test in one module.'), { fetchImpl: f, dir, random: () => 0.99 });
  assert.equal(createHash('sha256').update(sent).digest('hex'), '12dcd62b46793272f3c0a292f03fce408b25498cecc29082bb7069578158723a');
});
test('validation rejection', async () => {
  const good = () => payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 });
  const variants = {
    wrong_keys: (j) => { j.answers.model.probabilities = { haiku: 0.1, sonnet: 0.8, opus: 0.05, fable: 0.05 }; j.answers.model.choice = 'sonnet'; },
    missing_key: (j) => { j.answers.model.probabilities = { haiku: 0.1, sonnet: 0.9 }; },
    bad_sum: (j) => { j.answers.model.probabilities = { haiku: 0.1, sonnet: 0.85, opus: 0.1 }; },
    choice_not_argmax: (j) => { j.answers.model.choice = 'haiku'; },
    conf_high: (j) => { j.answers.model.confidence = 1.5; },
    conf_nan: (j) => { j.answers.model.confidence = null; },
    neg_prob: (j) => { j.answers.model.probabilities = { haiku: -0.1, sonnet: 1.0, opus: 0.1 }; },
  };
  for (const [n, mut] of Object.entries(variants)) {
    const j = good(); mut(j);
    const r = await one(task(), opts(fixed(j)));
    assert.equal(r.fallback_reason, 'invalid_response', n); assert.equal(r.model, null, n);
  }
  // tie: any argmax accepted
  const tie = payload({ haiku: 0.5, sonnet: 0.5, opus: 0 }, E, { choice: 'sonnet', confidence: 0.5 });
  assert.equal((await one(task(), opts(fixed(tie)))).fallback_reason, null);
});
test('response over 64 KiB rejected', async () => {
  const j = payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }); j.pad = 'x'.repeat(70 * 1024);
  const o = opts(fixed(j));
  const r = await one(task(), o);
  assert.equal(r.fallback_reason, 'invalid_response');
  assert.equal(lines(o.dir)[0].fallback_detail, 'Response body exceeds 64 KiB.');
});
test('failed shuffled side call logs side_error', async () => {
  const good = payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 });
  const o = opts(mockFetch((n) => respond(n === 1 ? good : 'nope')), { random: () => 0 });
  await one(task(), o);
  const l = lines(o.dir)[0];
  assert.equal(l.order_shuffled, true); assert.equal(l.choice_changed, null); assert.equal(l.side_error, 'Invalid response: not JSON');
});
test('timeout fail-open', async () => {
  const f = mockFetch((_, init) => new Promise((_, rej) => { const keep = setTimeout(() => {}, 5000); /* AbortSignal.timeout timers are unref'd */ init.signal.addEventListener('abort', () => { clearTimeout(keep); rej(init.signal.reason); }); }));
  const dir = tmp(); writeFileSync(join(dir, 'config.json'), JSON.stringify({ attemptTimeoutMs: 50, deadlineMs: 200 }));
  const r = await one(task(), { fetchImpl: f, dir, random: () => 0.99 });
  assert.equal(r.fallback_reason, 'timeout'); assert.equal(r.model, null);
});
test('http error maps to http_<status>', async () => {
  const r = await one(task(), opts(mockFetch(() => respond('secret body', 429))));
  assert.equal(r.fallback_reason, 'http_429');
});
test('credentials missing => fallback without calling fetch', async () => {
  const k = process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFE_API_KEY;
  try {
    const f = fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }));
    const r = await one(task(), opts(f));
    assert.equal(r.fallback_reason, 'credentials'); assert.equal(f.calls, 0);
    await assert.rejects(systemOne({ body: { questions: {} }, fetchImpl: f }), (e) => e instanceof JevError && e.kind === 'credentials');
  } finally { process.env.TYPESAFE_API_KEY = k; }
});
test('input guard', async () => {
  const f = fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }));
  const bad = {
    too_long: ['a '.repeat(201), 'too_long'], fence: ['Run ```ls``` now', 'code_fence'], win: ['Edit C:\\Users\\x\\a.txt', 'windows_path'],
    win2: ['Edit C:/Users/x', 'windows_path'], unc: ['Open \\\\srv\\share', 'unc_path'], home: ['Read ~/notes', 'tilde_path'],
    posix: ['Read /home/x/file', 'posix_path'], hex: ['id ' + 'a1b2c3d4'.repeat(4), 'hex_run'],
    b64: ['blob ' + 'Zm9vYmFyX1ps-_QUJD'.repeat(2), 'long_token_like_run'], key: ['api_key = abc', 'secret_assignment'],
    token: ['token: abc', 'secret_assignment'], pw: ['The Password = set', 'secret_assignment'],
    skprefix: ['use sk-abcdefghijklmnopqrst here', 'secret_prefix'], akia: ['id AKIAABCDEFGHIJKLMNOP', 'secret_prefix'],
    pem: ['-----BEGIN RSA PRIVATE KEY-----', 'private_key_block'], hangul: ['이 작업을 수행하세요 please', 'non_english'], num: [42, 'summary_not_string'],
  };
  for (const [n, [s, rule]] of Object.entries(bad)) {
    const r = await one(task(s), opts(f));
    assert.equal(r.fallback_reason, `input_rejected: ${rule}`, n); assert.equal(r.model, null, n);
  }
  assert.equal(f.calls, 0);
  for (const s of ['Review the token budget.', 'Fix the monkey patch.', 'Use the tokenizer.', 'Rename and/or move a helper.', 'Review packages/server/src/handlers/auth for style.', 'Read https://example.com/a/b/c docs.']) {
    const r = await one(task(s), opts(fixed(payload({ haiku: 0.9, sonnet: 0.05, opus: 0.05 }))));
    assert.equal(r.fallback_reason, null, s);
  }
  assert.throws(() => assertEnglish('이 작업을 수행하세요 그리고 또 다른 것'), (e) => e.kind === 'input');
  assert.doesNotThrow(() => assertEnglish('Fix the failing test and/or rename the helper.'));
  assert.equal((await one(task('Rename and/or move a helper.'), opts(fixed(payload({ haiku: 0.9, sonnet: 0.05, opus: 0.05 }))))).fallback_reason, null);
});
test('rejected input is not logged with its summary', async () => {
  const o = opts(fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })));
  await one(task('password = hunter2hunter2'), o);
  const [rec] = lines(o.dir);
  assert.deepEqual(Object.keys(rec).sort(), ['agent_type', 'fallback_reason', 'id', 'ts']);
  assert.ok(!readFileSync(join(o.dir, 'shadow.jsonl'), 'utf8').includes('hunter2'));
});
test('circuit breaker opens after 3 failures and skips the 4th', async () => {
  const f = mockFetch(() => respond('x', 500));
  const o = opts(f);
  for (let i = 0; i < 3; i++) assert.equal((await one(task(`Task number ${i}.`), o)).fallback_reason, 'http_500');
  assert.equal(f.calls, 3);
  assert.equal((await one(task('Task number 4.'), o)).fallback_reason, 'circuit_open');
  assert.equal(f.calls, 3);
});
test('cache hit skips the second call', async () => {
  const f = fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }));
  const o = opts(f);
  const a = await one(task(), o); const b = await one(task(), o);
  assert.equal(f.calls, 1); assert.equal(b.model, a.model); assert.equal(b.latency_ms, 0);
  assert.equal(lines(o.dir)[1].cached, true);
});
test('bias check logs order_shuffled and choice_changed', async () => {
  const mk = (flip) => mockFetch((n, _i, body) => respond(n === 1 || !flip ? payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }) : payload({ haiku: 0.05, sonnet: 0.1, opus: 0.85 })));
  const f1 = mk(true); const o1 = opts(f1, { random: () => 0 });
  const r = await one(task(), o1);
  assert.equal(f1.calls, 2); assert.equal(r.model, 'sonnet');
  assert.notDeepEqual(Object.keys(f1.last.questions.model.criteria), ['haiku', 'sonnet', 'opus']);
  let rec = lines(o1.dir)[0]; assert.equal(rec.order_shuffled, true); assert.equal(rec.choice_changed, true);
  const o2 = opts(mk(false), { random: () => 0 });
  await one(task(), o2); rec = lines(o2.dir)[0]; assert.equal(rec.choice_changed, false);
  // shuffled call fails: choice_changed null, output and breaker unaffected
  const f3 = mockFetch((n) => (n === 1 ? respond(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })) : respond('x', 500)));
  const o3 = opts(f3, { random: () => 0 });
  const r3 = await one(task(), o3);
  assert.equal(r3.model, 'sonnet'); assert.equal(lines(o3.dir)[0].choice_changed, null);
  assert.equal(JSON.parse(readFileSync(join(o3.dir, 'breaker.json'), 'utf8')).failures, 0);
  // not sampled
  const o4 = opts(fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })), { random: () => 0.5 });
  await one(task(), o4); assert.equal(lines(o4.dir)[0].order_shuffled, false);
});
test('shadow log line has all fields', async () => {
  const o = opts(fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })));
  await one(task(), o);
  const rec = lines(o.dir)[0];
  const want = ['ts', 'id', 'summary', 'agent_type', 'rule_model', 'probs', 'model', 'margin', 'confidence', 'latency_ms', 'fallback_reason', 'order_shuffled', 'choice_changed', 'cached', 'jev_model_alias', 'jev_model_resolved', 'effort_score', 'effort_probs', 'effort_confidence', 'effort'];
  for (const k of want) assert.ok(k in rec, k);
  assert.equal(rec.jev_model_resolved, 'jev-1.13-test'); assert.equal(rec.jev_model_alias, 'jev-latest');
  assert.ok(rec.probs.model); assert.equal(rec.effort, 'high'); assert.ok(!('effort_changed' in rec));
});
test('request shape and no key in outputs', async () => {
  let seen;
  const f = mockFetch((n, init) => { seen = init; return respond(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })); });
  const o = opts(f);
  const res = await run(task(), o);
  assert.equal(res[0].fallback_reason, null);
  assert.equal(seen.redirect, 'error'); assert.equal(seen.headers.Authorization, 'Bearer test-key-not-real');
  const out = JSON.stringify(res);
  assert.ok(!out.includes('test-key-not-real'));
  assert.ok(!readFileSync(join(o.dir, 'shadow.jsonl'), 'utf8').includes('test-key-not-real'));
  assert.equal(f.last.model, 'jev-latest'); assert.deepEqual(Object.keys(f.last.questions), ['model', 'effort']);
});
test('breaker: batch of 3 parallel 500s opens the breaker', async () => {
  const o = opts(mockFetch(() => respond('x', 500)));
  const input = { tasks: ['One task.', 'Two task.', 'Three task.'].map((s, i) => ({ id: `t${i}`, summary: s, agent_type: 'worker' })) };
  const rs = await run(input, o);
  assert.ok(rs.every((r) => r.fallback_reason === 'http_500'));
  const br = JSON.parse(readFileSync(join(o.dir, 'breaker.json'), 'utf8'));
  assert.ok(br.failures >= 3 && br.open_until > 0);
});
test('missing response model is allowed and logged as null', async () => {
  const j = payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }); delete j.model;
  const o = opts(fixed(j));
  assert.equal((await one(task(), o)).fallback_reason, null);
  assert.equal(lines(o.dir)[0].jev_model_resolved, null);
});
test('English guard (5% non-ASCII letters)', async () => {
  const f = fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }));
  const rejected = { hangul: '이 작업을 수행하세요', cjk: '修复这个测试', cyrillic: 'Исправить тест' };
  for (const [n, s] of Object.entries(rejected)) {
    assert.throws(() => assertEnglish(s), (e) => e.kind === 'input' && e.reason === 'non_english' && !e.message.includes(s), n);
    assert.equal((await one(task(s), opts(f))).fallback_reason, 'input_rejected: non_english', n);
  }
  assert.equal(f.calls, 0);
  await assert.rejects(systemOne({ body: { state: '이 작업을 수행하세요', questions: {} }, fetchImpl: f }), (e) => e.kind === 'input' && e.reason === 'non_english');
  assert.equal(f.calls, 0);
  assert.doesNotThrow(() => assertEnglish('Fix the failing unit test in one module and rename the helper function carefully 수'));
  assert.doesNotThrow(() => assertEnglish('Fix the café module in the parser'));
  const ok = 'Fix the “test” — it’s failing';
  assert.doesNotThrow(() => assertEnglish(ok));
  assert.equal((await one(task(ok), opts(fixed(payload({ haiku: 0.9, sonnet: 0.05, opus: 0.05 }))))).fallback_reason, null);
});
test('corrupt cache entry is a miss, not internal_error', async () => {
  const f = fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }));
  const o = opts(f);
  await one(task(), o);
  const cdir = join(o.dir, 'cache'); const file = join(cdir, readdirSync(cdir)[0]);
  writeFileSync(file, JSON.stringify({ ts: Date.now(), response: { answers: {} } }));
  const r = await one(task(), o);
  assert.equal(r.fallback_reason, null); assert.equal(r.model, 'sonnet'); assert.equal(f.calls, 2);
});
test('expired deadline => timeout, not cancelled', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'config.json'), JSON.stringify({ deadlineMs: 1 }));
  const f = fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }));
  await new Promise((r) => setTimeout(r, 0));
  const slow = mockFetch(async (_, init) => { await new Promise((r) => setTimeout(r, 30)); return f(); });
  const r = await one(task(), { fetchImpl: slow, dir, random: () => 0.99 });
  assert.equal(r.fallback_reason, 'timeout');
});
test('bad config values fall back to defaults', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'config.json'), JSON.stringify({ confidenceFloor: 'x', deadlineMs: null, attemptTimeoutMs: -1e999, biasSampleRate: {} }));
  const r = await one(task(), { fetchImpl: fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })), dir, random: () => 0.99 });
  assert.equal(r.model, 'sonnet');
});

test('no margin rule: close top two stays argmax; rule_effort ignored', async () => {
  const r = await one(task(), opts(fixed(payload({ haiku: 0.14, sonnet: 0.46, opus: 0.4 }, E, { confidence: 0.9 }))));
  assert.equal(r.model, 'sonnet'); assert.equal(r.effort, 'high');
});
test('effort: score rounds to a level, no step-up', async () => {
  for (const [s, lvl] of [[0, 'low'], [1.4, 'medium'], [1.5, 'high'], [3.6, 'max']]) {
    const r = await one(task(), opts(fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, s, {}, { confidence: 0.1 }))));
    assert.equal(r.effort, lvl, String(s)); assert.equal(r.effort_score, s);
  }
});
test('effort: missing or bad effort answer -> effort null, model kept', async () => {
  for (const j of [payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, null), payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, 7)]) {
    const r = await one(task(), opts(fixed(j)));
    assert.equal(r.model, 'sonnet'); assert.equal(r.effort, null); assert.equal(r.fallback_reason, null);
  }
});
test('effort: shadow line carries effort fields; side call asks model only', async () => {
  const f = mockFetch((n, init, body) => respond(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, body.questions.effort ? 2 : null)));
  const o = opts(f, { random: () => 0.1 }); // < biasSampleRate: side call happens
  await one(task(), o);
  const rec = lines(o.dir)[0];
  assert.equal(rec.effort, 'high'); assert.equal(rec.effort_score, 2); assert.equal(rec.effort_confidence, 0.5); assert.equal(rec.effort_probs['2'], 0.4);
  assert.equal(f.calls, 2);
});
test('cache hit keeps effort; the cache key depends on EFFORT_Q', async () => {
  const f = fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, 3)); const o = opts(f);
  const a = await one(task(), o); const b = await one(task(), o);
  assert.equal(f.calls, 1); assert.equal(a.effort, 'xhigh'); assert.equal(b.effort, 'xhigh');
});
test('a model-only cache entry under the pre-effort key is never read', async () => {
  const summary = 'Fix a failing unit test in one module.';
  const o = opts(fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, 3)));
  const oldKey = createHash('sha1').update('jev-latest' + summary + JSON.stringify(Object.keys(MODEL_Q.criteria)) + JSON.stringify(MODEL_Q)).digest('hex');
  mkdirSync(join(o.dir, 'cache'), { recursive: true });
  writeFileSync(join(o.dir, 'cache', oldKey + '.json'), JSON.stringify({ ts: Date.now(), response: payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, null) }));
  const r = await one(task(summary), o);
  assert.equal(o.fetchImpl.calls, 1); assert.equal(r.effort, 'xhigh'); assert.equal(lines(o.dir)[0].cached, false);
});
test('doctor: effort validity is its own check line', async () => {
  const good = await doctor({ fetchImpl: fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 })), dir: tmp() });
  assert.ok(good.some((l) => l.startsWith('PASS round trip')), good.join('|')); assert.ok(good.includes('PASS effort answer valid'), good.join('|'));
  const bad = await doctor({ fetchImpl: fixed(payload({ haiku: 0.05, sonnet: 0.85, opus: 0.1 }, 7)), dir: tmp() });
  assert.ok(bad.some((l) => l.startsWith('PASS round trip')), bad.join('|')); assert.ok(bad.includes('FAIL effort answer valid'), bad.join('|'));
});
test('floor: reviewer haiku pick -> sonnet, logged raw and floor_applied', async () => {
  const o = opts(fixed(payload({ haiku: 0.9, sonnet: 0.05, opus: 0.05 })));
  const r = await one(task('Fix a failing unit test in one module.', { agent_type: 'reviewer' }), o);
  assert.equal(r.model, 'sonnet');
  const l = lines(o.dir)[0];
  assert.equal(l.jev_raw, 'haiku'); assert.equal(l.floor_applied, true); assert.equal(l.model, 'sonnet');
});
test('floor: analyst opus pick unchanged; worker haiku unchanged', async () => {
  const o = opts(fixed(payload({ haiku: 0.05, sonnet: 0.05, opus: 0.9 })));
  assert.equal((await one(task('Fix a failing unit test in one module.', { agent_type: 'analyst' }), o)).model, 'opus');
  assert.equal(lines(o.dir)[0].floor_applied, false);
  const o2 = opts(fixed(payload({ haiku: 0.9, sonnet: 0.05, opus: 0.05 })));
  const r = await one(task('Fix a failing unit test in one module.', { agent_type: 'worker' }), o2);
  assert.equal(r.model, 'haiku'); assert.equal(lines(o2.dir)[0].floor_applied, false);
});
test('floor applies on the cached path too', async () => {
  const o = opts(fixed(payload({ haiku: 0.9, sonnet: 0.05, opus: 0.05 })));
  const inp = task('Fix a failing unit test in one module.', { agent_type: 'reviewer' });
  await one(inp, o);
  const r = await one(inp, o);
  assert.equal(r.model, 'sonnet'); assert.equal(lines(o.dir)[1].cached, true); assert.equal(lines(o.dir)[1].floor_applied, true);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
