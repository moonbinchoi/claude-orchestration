import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onPrompt, TEXT } from './main-pick-trigger.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'mpt-test-'));
const CLI = { CLAUDE_CODE_ENTRYPOINT: 'cli' };
const logs = (d) => readFileSync(join(d, 'main-pick.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('fires on cli and claude-vscode; output shape and log', () => {
  for (const ep of ['cli', 'claude-vscode']) {
    const d = tmp();
    const o = onPrompt({ session_id: 's1' }, { dir: d, env: { CLAUDE_CODE_ENTRYPOINT: ep } });
    assert.deepEqual(o, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: TEXT } });
    assert.ok(existsSync(join(d, 'main-pick-seen', 's1')));
    const l = logs(d)[0];
    assert.deepEqual(l, { ts: l.ts, kind: 'trigger', fired: true, skip_reason: null, entrypoint: ep, attended: null, session_id: 's1' });
  }
  assert.ok(TEXT.includes('main-pick.mjs "<summary>"') && !TEXT.includes('{'));
  assert.ok(TEXT.includes('already matches') && TEXT.includes('same turn') && TEXT.includes('/model and /effort'));
});
test('skip: unattended (nested claude -p inherits ENTRYPOINT); attended 1 fires', () => {
  const d = tmp();
  assert.equal(onPrompt({ session_id: 's1' }, { dir: d, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', CLAUDE_CODE_SESSION_ATTENDED: '0' } }), null);
  assert.equal(logs(d)[0].skip_reason, 'unattended');
  assert.equal(existsSync(join(d, 'main-pick-seen', 's1')), false);
  assert.ok(onPrompt({ session_id: 's1' }, { dir: d, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', CLAUDE_CODE_SESSION_ATTENDED: '1' } }));
});
test('skip: other entrypoint or none', () => {
  for (const env of [{ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, {}]) {
    const d = tmp();
    assert.equal(onPrompt({ session_id: 's1' }, { dir: d, env }), null);
    assert.equal(logs(d)[0].skip_reason, 'entrypoint'); assert.equal(logs(d)[0].fired, false);
    assert.equal(existsSync(join(d, 'main-pick-seen')), false);
  }
});
test('skip: missing or bad session id', () => {
  const d = tmp();
  assert.equal(onPrompt({}, { dir: d, env: CLI }), null);
  assert.equal(onPrompt({ session_id: '../evil' }, { dir: d, env: CLI }), null);
  assert.deepEqual(logs(d).map((l) => l.skip_reason), ['no_session_id', 'bad_session_id']);
  assert.equal(existsSync(join(d, 'main-pick-seen')), false);
});
test('second call in the same session -> null', () => {
  const d = tmp();
  assert.ok(onPrompt({ session_id: 's1' }, { dir: d, env: CLI }));
  assert.equal(onPrompt({ session_id: 's1' }, { dir: d, env: CLI }), null);
  assert.equal(logs(d)[1].skip_reason, 'seen');
  assert.ok(onPrompt({ session_id: 's2' }, { dir: d, env: CLI }));
});
test('transcript with assistant line -> marker written, null', () => {
  const d = tmp(); const t = join(d, 't.jsonl');
  writeFileSync(t, '{"type":"user","message":"hi"}\n{"type":"assistant","message":"hello"}\n');
  assert.equal(onPrompt({ session_id: 's1', transcript_path: t }, { dir: d, env: CLI }), null);
  assert.ok(existsSync(join(d, 'main-pick-seen', 's1')));
  assert.equal(logs(d)[0].skip_reason, 'resumed_session');
});
test('transcript with only user lines, or missing -> fires', () => {
  const d = tmp(); const t = join(d, 't.jsonl');
  writeFileSync(t, '{"type":"user","message":"hi"}\n');
  assert.ok(onPrompt({ session_id: 's1', transcript_path: t }, { dir: d, env: CLI }));
  assert.ok(onPrompt({ session_id: 's2', transcript_path: join(d, 'none.jsonl') }, { dir: d, env: CLI }));
});
test('assistant entry far into the transcript is seen (live case: 320 KB)', () => {
  const d = tmp(); const t = join(d, 't.jsonl');
  writeFileSync(t, ' '.repeat(400 * 1024) + '{"type":"assistant"}\n');
  assert.equal(onPrompt({ session_id: 's1', transcript_path: t }, { dir: d, env: CLI }), null);
  assert.equal(logs(d)[0].skip_reason, 'resumed_session');
});
test('marker write failure -> null, never fires', () => {
  const d = tmp();
  writeFileSync(join(d, 'main-pick-seen'), 'a file, not a dir');
  assert.equal(onPrompt({ session_id: 's1' }, { dir: d, env: CLI }), null);
  assert.equal(logs(d)[0].skip_reason, 'marker_write_failed');
});
test('never throws on odd input', () => {
  assert.equal(onPrompt(null, { dir: tmp(), env: CLI }), null);
  assert.equal(onPrompt({ session_id: 's1' }, { dir: join(tmp(), 'x', '\0bad'), env: CLI }), null);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
