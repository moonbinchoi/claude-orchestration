import assert from 'node:assert/strict';
import { classifyFailure, compareCauses, redact } from './failure-cause.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const cf = (text, status = 'BLOCKED', launchStatus = null) => classifyFailure({ text, status, launchStatus });

test('not failed -> null; failed by status or launch status', () => {
  assert.equal(cf('DONE\nall good', 'DONE'), null); assert.equal(cf('x', 'unknown'), null); assert.equal(cf('x', 'unknown', 'completed'), null);
  assert.ok(cf('x failed', 'PARTIAL')); assert.ok(cf('{"status":"error"}', null, 'error')); assert.ok(cf('x', null, 'launch_failed'));
});
test('cause from the remainder of the first line', () => {
  const f = cf('BLOCKED: tests fail because the fixture is stale\nother notes');
  assert.equal(f.cause_original, 'tests fail because the fixture is stale'); assert.equal(f.lang, 'en'); assert.equal(f.cause_en, 'tests fail because the fixture is stale'); assert.equal(f.skip_reason, null);
});
test('first keyword line after the status line; fallback to first non-empty line; no cause', () => {
  assert.equal(cf('BLOCKED\n\nI looked around\nThe build failed on step 3\nlast line').cause_original, 'The build failed on step 3');
  assert.equal(cf('BLOCKED\nthe decision is open\nmore').cause_original, 'the decision is open');
  const n = cf('BLOCKED'); assert.deepEqual([n.cause_original, n.cause_sig, n.cause_en, n.skip_reason], [null, null, null, 'no_cause']);
});
test('cause_original capped at 300', () => assert.equal(cf('BLOCKED: error ' + 'x'.repeat(500)).cause_original.length, 300));
test('Korean OS message: ko, never sent, subkind permission', () => {
  const f = cf("BLOCKED\n'C:\\data\\out.txt' 파일에 대한 액세스가 거부되었습니다.");
  assert.equal(f.lang, 'ko'); assert.equal(f.cause_en, null); assert.equal(f.skip_reason, 'non_english'); assert.equal(f.subkind, 'permission'); assert.ok(f.cause_sig);
});
test('Korean missing command message -> missing_tool', () => {
  const f = cf("BLOCKED\n'pnpm'은(는) 내부 또는 외부 명령, 실행할 수 있는 프로그램, 또는 배치 파일이 아닙니다. 인식되지 않습니다 오류");
  assert.equal(f.subkind, 'missing_tool'); assert.equal(f.lang, 'ko');
});
test('mixed English report with a quoted Korean line: English keyword line chosen', () => {
  const f = cf('BLOCKED\n로그: "오류가 발생했습니다"\nThe import step failed: cannot read the config');
  assert.equal(f.lang, 'en'); assert.equal(f.cause_original, 'The import step failed: cannot read the config');
});
test('subkinds in order over all keyword lines', () => {
  const sub = (t) => cf('BLOCKED\n' + t).subkind;
  assert.equal(sub('error: HTTP 429 rate limit'), 'transient'); assert.equal(sub('request failed: ECONNRESET'), 'transient');
  assert.equal(sub('401 unauthorized'), 'auth'); assert.equal(sub('invalid api key'), 'auth');
  assert.equal(sub('EACCES: permission denied'), 'permission'); assert.equal(sub('getaddrinfo ENOTFOUND host'), 'network');
  assert.equal(sub('error: command not found: pnpm'), 'missing_tool'); assert.equal(sub('error: something odd'), null);
  assert.equal(sub('error: 401 unauthorized after 429 too many requests'), 'transient');
});
test('redact: paths, url, email, key=value, hex, tokens, digits', () => {
  assert.equal(redact('open C:\\Users\\bob\\a.txt failed'), 'open <path> failed');
  assert.equal(redact('open \\\\srv\\share\\a failed'), 'open <path> failed');
  assert.equal(redact('see ~/work/x and /etc/hosts and src/app/main.js'), 'see <path> and <path> and <path>');
  assert.equal(redact('GET https://example.com/a?b=1 failed'), 'GET <url> failed');
  assert.equal(redact('mail bob@example.com now'), 'mail <email> now');
  assert.equal(redact('api_key=sk-abc123 and password: hunter2 and Authorization: Bearer xyz9'), 'api_key <redacted> and password <redacted> and Authorization <redacted>');
  assert.equal(redact('commit deadbeef1234 sha'), 'commit <hex> sha');
  assert.equal(redact('id Zk3jH8s9Dk2LmN7pQ4rT5v end'), 'id <token> end');
  assert.equal(redact('exit code 12345 at   line 7'), 'exit code <n> at line 7');
});
test('round 2: subkind only from the cause line (+ a following non-English line)', () => {
  assert.equal(cf('BLOCKED\nbuild failed\nthen got a 403 forbidden later').subkind, null);
  for (const t of ['overloaded constructor in Parser is untested', 'Added handling for 403 Forbidden responses', '네트워크 모듈 리팩터링 남음']) assert.equal(cf('BLOCKED\nTests failed\n' + t).subkind, null, t);
  assert.equal(cf("BLOCKED\nnpm install failed with:\n'npm'은(는) 내부 또는 외부 명령, 실행할 수 있는 프로그램, 또는 배치 파일이 아닙니다.").subkind, 'missing_tool');
  assert.equal(cf('BLOCKED\nthe API is overloaded, try later').subkind, 'transient'); assert.equal(cf('BLOCKED\nrequest failed: access forbidden').subkind, 'permission');
  assert.equal(cf('BLOCKED\nrequest failed: 네트워크 오류').subkind, 'network');
});
test('round 2: only "no <noun>" is a negation', () => {
  assert.equal(cf('BLOCKED\nbuild error: no such file, 3 errors\nNo issues found.').cause_original, 'build error: no such file, 3 errors');
});
test('H3: boilerplate and loose words give no subkind', () => {
  for (const t of ['Reviewed src/auth.ts:429 for null checks', 'Unverified: authentication middleware wiring', 'rate limiter feature incomplete', '권한 검사 로직 추가 필요', 'error code in the parser is a string']) assert.equal(cf('BLOCKED\n' + t).subkind, null, t);
  assert.equal(cf('BLOCKED\nTests failed: 3 of 40\nNo permission issues found.').cause_original, 'Tests failed: 3 of 40');
  assert.equal(cf('BLOCKED\nNo permission issues found.\nTests failed: 3 of 40').subkind, null);
  assert.equal(cf('BLOCKED\nNo errors found.\nsomething else happened').cause_original, 'No errors found.'); // no keyword line: first line after status
  assert.equal(cf('BLOCKED\nstatus: 403').subkind, 'permission'); assert.equal(cf('BLOCKED\n429 Too Many Requests').subkind, 'transient');
  assert.equal(cf('BLOCKED\nauthentication failed for the API').subkind, 'auth'); assert.equal(cf('BLOCKED\n인증에 실패했습니다').subkind, 'auth');
});
test('H4/L11: backslash paths never reach cause_en; secrets without digits redacted', () => {
  const p1 = 'C:\\Users\\me\\My Documents\\acme-payroll\\salaries.xlsx', p2 = 'src\\acme\\billing\\Invoice.cs';
  for (const t of [`cannot open ${p1}`, `build failed in ${p2}`]) {
    const f = cf('BLOCKED: ' + t); assert.ok(f.cause_en === null || !/acme|payroll|Users|billing/.test(f.cause_en), t);
  }
  assert.equal(redact(`cannot open ${p1} now`), 'cannot open <path> now');
  assert.equal(redact(`build failed in ${p2} again`), 'build failed in <path> again');
  assert.equal(redact('wrong password hunter and token expired'), 'wrong password <redacted> and token expired');
});
test('guard rejection -> cause_en null with the guard reason', () => {
  const f = cf('BLOCKED: failed with ' + 'x'.repeat(2) + ' ```code``` error');
  assert.equal(f.cause_en, null); assert.equal(f.skip_reason, 'code_fence');
});
test('cause_en is redacted and capped at 200', () => {
  const f = cf('BLOCKED: error opening C:\\a\\b.txt for bob@example.com ' + 'word '.repeat(80));
  assert.ok(f.cause_en.startsWith('error opening <path> for <email>')); assert.ok(f.cause_en.length <= 200);
});
test('cause_sig ignores digits, case, whitespace and paths', () => {
  const a = cf('BLOCKED: Build failed at step 3 in C:\\a\\x.js'), b = cf('BLOCKED: build  FAILED at step 17 in D:\\b\\y.js'), c = cf('BLOCKED: build failed at phase 3');
  assert.equal(a.cause_sig, b.cause_sig); assert.notEqual(a.cause_sig, c.cause_sig); assert.equal(a.cause_sig.length, 64);
  assert.equal(compareCauses(a, b).sig_equal, true); assert.ok(compareCauses(a, b).jaccard >= 0.5);
});
test('compareCauses jaccard', () => {
  const r = compareCauses(cf('BLOCKED: build failed in module alpha'), cf('BLOCKED: build failed in module beta'));
  assert.equal(r.sig_equal, false); assert.ok(r.jaccard > 0.5 && r.jaccard < 1);
  assert.equal(compareCauses(cf('BLOCKED: error one'), cf('BLOCKED')).sig_equal, false);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
