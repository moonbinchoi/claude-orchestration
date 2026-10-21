import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { evaluate } from './stop-guard.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const answer = (yes, over = {}) => ({ choice: yes >= 0.5 ? 'yes' : 'no', probabilities: { yes, no: 1 - yes }, confidence: Math.abs(2 * yes - 1), ...over });
const payload = (yes, over) => ({ model: 'jev-1.13-test', answers: { promised_and_stopped: answer(yes, over) } });
const respond = (obj, status = 200) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status });
const mockFetch = (handler) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); return handler(f.calls, init); }; f.calls = 0; return f; };
const fixed = (obj, status) => mockFetch(() => respond(obj, status));
const tmp = () => mkdtempSync(join(tmpdir(), 'sg-test-'));
const cfg = (dir, c) => writeFileSync(join(dir, 'config.json'), JSON.stringify(c));
const logLines = (dir) => (existsSync(join(dir, 'stop-guard.jsonl')) ? readFileSync(join(dir, 'stop-guard.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const msg = (m, extra = {}) => ({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: m, ...extra });
const ev = (m, f = fixed(payload(0.95)), extra = {}, o = {}) => { const dir = o.dir ?? tmp(); return evaluate(msg(m, extra), { fetchImpl: f, dir, random: () => 0.99, ...o }).then((r) => ({ ...r, dir, f })); };

const KO_STRONG = '테스트를 실행하겠습니다.';
const EN_STRONG = "I'll run the tests now.";
const EN_WEAK = 'Next, the build will be checked.';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('ko strong -> would_block, no fetch, english_sent null', async () => {
  const r = await ev(`작업을 정리했습니다. 이제 ${KO_STRONG}`);
  assert.equal(r.record.verdict, 'would_block'); assert.equal(r.f.calls, 0);
  assert.equal(r.record.english_sent, null); assert.equal(r.record.jev_skipped, 'non_english'); assert.equal(r.record.lang, 'ko');
});
test('ko strong colon form', async () => assert.equal((await ev('먼저 파일을 읽어 보겠습니다:')).record.verdict, 'would_block'));
test('ko strong over 120 chars -> pass', async () => assert.equal((await ev('가'.repeat(120) + '를 실행하겠습니다.')).record.verdict, 'pass'));
test('ko weak -> pass without fetch', async () => {
  const r = await ev('테스트도 하겠습니다 일단 구조부터 봅니다.');
  assert.equal(r.record.prefilter, 'weak'); assert.equal(r.record.verdict, 'pass'); assert.equal(r.f.calls, 0);
});
for (const m of ['원하시면 진행하겠습니다.', '계속 진행할까요?', '모든 테스트를 통과했습니다.', '수정을 완료했습니다.', '말씀해 주세요.']) {
  test(`ko negative: ${m}`, async () => { const r = await ev(m); assert.equal(r.record, null); assert.equal(r.f.calls, 0); });
}
test('en strong -> would_block, no fetch', async () => {
  const r = await ev(EN_STRONG);
  assert.equal(r.record.verdict, 'would_block'); assert.equal(r.f.calls, 0); assert.equal(r.record.prefilter, 'strong');
});
test('en strong after other sentences uses last sentence only', async () => assert.equal((await ev('Fixed the bug. Now I will run the tests:')).record.verdict, 'would_block'));
test('en weak + Jev yes -> would_block; state and english_sent equal sentence', async () => {
  const r = await ev(EN_WEAK);
  assert.equal(r.record.verdict, 'would_block'); assert.equal(r.f.calls, 1);
  assert.equal(r.f.last.state, EN_WEAK); assert.equal(r.record.english_sent, EN_WEAK);
  assert.equal(r.record.jev_p_yes, 0.95); assert.equal(r.record.jev_model_resolved, 'jev-1.13-test'); assert.equal(r.f.last.model, 'jev-latest');
});
test('privacy: request body is exactly model/state/questions and state is only the last sentence', async () => {
  const full = 'Secret earlier sentence about customer Acme. The migration finished. ' + EN_WEAK;
  const r = await ev(full, undefined, { cwd: 'C:\\work\\acme', transcript_path: 'T', session_id: 'sess-xyz' });
  assert.deepEqual(Object.keys(r.f.last), ['model', 'state', 'questions']);
  const wire = JSON.stringify(r.f.last);
  for (const leak of ['Acme', 'migration', 'sess-xyz', 'acme', 'transcript']) assert.ok(!wire.includes(leak), leak);
  assert.equal(r.f.last.state, EN_WEAK);
});
test('en weak with p_yes 0.6 -> pass', async () => assert.equal((await ev(EN_WEAK, fixed(payload(0.6)))).record.verdict, 'pass'));
test('en weak yes but low confidence -> pass', async () => assert.equal((await ev(EN_WEAK, fixed(payload(0.9, { confidence: 0.5 })))).record.verdict, 'pass'));
test('modelAlias from config', async () => {
  const dir = tmp(); cfg(dir, { modelAlias: 'jev-pinned' });
  const r = await ev(EN_WEAK, undefined, {}, { dir }); assert.equal(r.f.last.model, 'jev-pinned');
});
test('Jev hang -> pass + jev_error timeout, no throw', async () => {
  const keep = setTimeout(() => {}, 5000); // AbortSignal.timeout timers are unref'd; keep the loop alive
  const f = mockFetch((n, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))));
  const r = await ev(EN_WEAK, f); clearTimeout(keep);
  assert.equal(r.record.verdict, 'pass'); assert.equal(r.record.jev_error, 'timeout');
});
test('Jev AbortError -> pass + jev_error', async () => {
  const r = await ev(EN_WEAK, mockFetch(() => { throw new DOMException('aborted', 'AbortError'); }));
  assert.equal(r.record.verdict, 'pass'); assert.ok(r.record.jev_error);
});
for (const [name, body] of [
  ['bad JSON', 'not json{'],
  ['probabilities not summing to 1', { model: 'm', answers: { promised_and_stopped: { choice: 'yes', probabilities: { yes: 0.9, no: 0.3 }, confidence: 0.8 } } }],
  ['missing keys', { model: 'm', answers: {} }],
]) {
  test(`Jev invalid response: ${name}`, async () => {
    const r = await ev(EN_WEAK, fixed(body));
    assert.equal(r.record.verdict, 'pass'); assert.equal(r.record.jev_error, 'invalid_response');
  });
}
test('Jev HTTP 500 -> pass', async () => {
  const r = await ev(EN_WEAK, fixed('boom', 500)); assert.equal(r.record.verdict, 'pass'); assert.equal(r.record.jev_error, 'http_500');
});
for (const [name, m, rule] of [
  ['windows path', 'Next, check C:\\Users\\me\\proj\\a.js.', 'windows_path'],
  ['secret assignment', 'Next, check that password = hunter2 works.', 'secret_assignment'],
  ['relative path', 'Next, I need to fix src/billing/refund.ts for the client.', 'path_url_email'],
  ['url', 'Next, check https://grafana.example/d/payroll before deploying.', 'path_url_email'],
  ['email', 'Next, update the record for jane.doe@acme.com today.', 'path_url_email'],
  ['too long', 'Next, ' + 'the build will be checked '.repeat(10) + 'again.', 'too_long'],
]) {
  test(`guard rejection: ${name}`, async () => {
    const r = await ev(m);
    assert.equal(r.f.calls, 0); assert.equal(r.record.jev_skipped, rule); assert.equal(r.record.verdict, 'pass'); assert.equal(r.record.english_sent, null);
  });
}
test('list-prefixed last line is graded without the marker', async () => {
  for (const m of ["Plan:\n- I'll run the tests.", "Plan:\n2. I'll run the tests.", '- 테스트를 실행하겠습니다.']) assert.equal((await ev(m)).record.verdict, 'would_block', m);
});
for (const m of ['환경변수 변경과 폴더 삭제는 승인 후에 하겠습니다.', '어느 쪽이든 앱을 종료한 뒤에 진행하겠습니다.', '빌드가 끝나면 이어서 보고하겠습니다.', '그때 repo 개수를 확인하겠습니다.', '그러면 트랙 수업을 시작하겠습니다.', '9회차에 정할 때 직접 확인하겠습니다.', '고치는 일은 그다음에 정할게요.', '1~3번은 새 기준이 정해질 때까지 보류할게요.', '세션이 돌고 있지 않다고 확인해 주면 진행할게요.', 'C가 정해지면 확인하겠습니다.', '분석 결과가 오면 이어서 정리할게요.']) {
  test(`ko condition or wait -> none: ${m}`, async () => { const r = await ev(m); assert.equal(r.record, null); assert.equal(r.f.calls, 0); });
}
for (const m of ['승인해 주시면 마이그레이션을 적용하겠습니다.','다음 세션에서 2b 단계를 진행하겠습니다.', '배포는 내일 확인하겠습니다.', "I'll apply the migration once you approve.", "I'll check back after you run the deploy.", 'I will fix the flaky test later.', 'The remaining work will be done in the next session.']) {
  test(`waits on user or deferred -> none: ${m}`, async () => { const r = await ev(m); assert.equal(r.record, null); assert.equal(r.f.calls, 0); });
}
for (const m of ['The fix is in place and the module is clean.', '최종 결과는 위와 같습니다.', 'Do you want me to run the tests?', "Let me know if you'd like me to continue.", 'All tests pass.', "I've updated the file.", 'The task is done.']) {
  test(`prefilter none: ${m}`, async () => {
    const r = await ev(m); assert.equal(r.f.calls, 0); assert.equal(r.record, null); assert.equal(logLines(r.dir).length, 0);
  });
}
test('none sampled at 5% when random low', async () => {
  const dir = tmp();
  const r = await evaluate(msg('The task is done.'), { dir, random: () => 0.01, fetchImpl: fixed(payload(0.95)) });
  assert.equal(r.output, null); const l = logLines(dir); assert.equal(l.length, 1); assert.equal(l[0].prefilter, 'none'); assert.equal(l[0].verdict, 'pass');
});
test('stop_hook_active -> nulls, no log, no fetch', async () => {
  const r = await ev(EN_STRONG, undefined, { stop_hook_active: true }, { random: () => 0.01 });
  assert.deepEqual([r.output, r.record], [null, null]); assert.equal(r.f.calls, 0); assert.equal(logLines(r.dir).length, 0);
});
test('mode log never outputs', async () => { const r = await ev(EN_STRONG); assert.equal(r.record.verdict, 'would_block'); assert.equal(r.output, null); });
test('mode block outputs exact block JSON', async () => {
  const dir = tmp(); cfg(dir, { stopGuard: { mode: 'block' } });
  const r = await ev(EN_STRONG, undefined, {}, { dir });
  assert.deepEqual(JSON.parse(r.output), { decision: 'block', reason: 'You said you would do the next step but ended the turn without doing it. Do it now with a tool call, or state plainly that you are finished or blocked.' });
});
test('mode block, pass verdict -> no output', async () => {
  const dir = tmp(); cfg(dir, { stopGuard: { mode: 'block' } });
  assert.equal((await ev(EN_WEAK, fixed(payload(0.6)), {}, { dir })).output, null);
});
test('unknown mode behaves as log', async () => {
  const dir = tmp(); cfg(dir, { stopGuard: { mode: 'banana' } });
  const r = await ev(EN_STRONG, undefined, {}, { dir }); assert.equal(r.output, null); assert.equal(r.record.mode, 'log');
});
test('mode off -> nothing, no log', async () => {
  const dir = tmp(); cfg(dir, { stopGuard: { mode: 'off' } });
  const r = await ev(EN_STRONG, undefined, {}, { dir, random: () => 0.01 });
  assert.deepEqual([r.output, r.record], [null, null]); assert.equal(logLines(dir).length, 0);
});
test('missing / non-string / empty last_assistant_message', async () => {
  for (const m of [undefined, null, 42, '', '   ']) { const r = await ev(m, undefined, {}, { random: () => 0.01 }); assert.deepEqual([r.output, r.record], [null, null]); }
});
test('message ending in code fence -> none', async () => {
  for (const m of ["I'll run this:\n```\nnpm test\n```", "I'll run this:\n```\nnpm test"]) { const r = await ev(m); assert.equal(r.record, null); }
});
const jl = (o) => JSON.stringify(o);
const TRANSCRIPT = [
  jl({ type: 'user', message: { content: 'old prompt' } }),
  jl({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
  jl({ type: 'user', message: { content: 'real prompt' } }),
  'garbage line',
  jl({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Read' }] } }),
  jl({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
  jl({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] } }),
].join('\n');
test('transcript: tool_use after last real prompt counted, tool_result does not reset', async () => {
  const r = await ev(EN_STRONG, undefined, { transcript_path: 'x' }, { transcriptReader: () => TRANSCRIPT });
  assert.equal(r.record.transcript_ok, true); assert.equal(r.record.tools_in_turn, 2);
});
test('transcript: user text block starts a new turn', async () => {
  const t = TRANSCRIPT + '\n' + jl({ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } });
  assert.equal((await ev(EN_STRONG, undefined, { transcript_path: 'x' }, { transcriptReader: () => t })).record.tools_in_turn, 0);
});
test('transcript unreadable -> transcript_ok false, decision unchanged', async () => {
  const r = await ev(EN_STRONG, undefined, { transcript_path: 'x' }, { transcriptReader: () => { throw new Error('ENOENT'); } });
  assert.equal(r.record.transcript_ok, false); assert.equal(r.record.tools_in_turn, null); assert.equal(r.record.verdict, 'would_block');
});
test('transcript default reader on missing file -> transcript_ok false', async () => {
  const r = await ev(EN_STRONG, undefined, { transcript_path: join(tmp(), 'nope.jsonl') });
  assert.equal(r.record.transcript_ok, false);
});
test('log line written with expected fields', async () => {
  const r = await ev(EN_STRONG);
  const l = logLines(r.dir); assert.equal(l.length, 1);
  for (const k of ['ts', 'session_id', 'mode', 'lang', 'prefilter', 'original', 'english_sent', 'jev_skipped', 'jev_p_yes', 'jev_confidence', 'jev_model_resolved', 'latency_ms', 'verdict', 'jev_error', 'transcript_ok', 'tools_in_turn']) assert.ok(k in l[0], k);
});
test('unwritable log dir never throws', async () => {
  const r = await evaluate(msg(EN_STRONG), { dir: join(tmp(), 'missing', 'sub'), random: () => 0.99 });
  assert.equal(r.record.verdict, 'would_block');
});

const script = join(dirname(fileURLToPath(import.meta.url)), 'stop-guard.mjs');
const cli = (input, dir) => { const t0 = Date.now(); const r = spawnSync('node', [script], { input, env: { ...process.env, JEV_DIR: dir }, encoding: 'utf8', timeout: 2000 }); return { ...r, ms: Date.now() - t0 }; };
test('CLI: garbage, empty and negative stdin exit 0 silently', () => {
  const dir = tmp();
  for (const input of ['not json', '', JSON.stringify(msg('The task is done.')), '[]', 'null']) {
    const r = cli(input, dir); assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.ok(r.ms < 2000);
  }
});
test('CLI: stdin left open -> hard cap exits 0 before the 5 s hook timeout', async () => {
  const t0 = Date.now();
  const p = spawn('node', [script], { env: { ...process.env, JEV_DIR: tmp() }, stdio: ['pipe', 'pipe', 'ignore'] });
  const code = await new Promise((res) => p.on('exit', res));
  const ms = Date.now() - t0;
  assert.equal(code, 0); assert.ok(ms >= 3500 && ms < 4800, `exited after ${ms} ms`);
});
test('CLI: block mode prints block JSON and exits 0', () => {
  const dir = tmp(); cfg(dir, { stopGuard: { mode: 'block' } });
  const r = cli(JSON.stringify(msg(KO_STRONG)), dir);
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).decision, 'block');
});
test('CLI: log mode prints nothing but logs', () => {
  const dir = tmp(); const r = cli(JSON.stringify(msg(KO_STRONG)), dir);
  assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(logLines(dir)[0].verdict, 'would_block');
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
