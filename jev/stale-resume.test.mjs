import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onPrompt } from './stale-resume.mjs';
import { evaluate } from './agent-hooks.mjs';

const T0 = Date.parse('2026-11-07T00:00:00Z');
const HOUR = 60 * 60 * 1000;
const env = { CLAUDE_CODE_ENTRYPOINT: 'cli' };
const rec = (o) => JSON.stringify({ type: 'assistant', timestamp: new Date(T0).toISOString(), message: { model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 190_000, cache_creation_input_tokens: 5_000 } }, ...o });
const setup = (lines) => {
  const dir = mkdtempSync(join(tmpdir(), 'stale-test-'));
  const transcript_path = join(dir, 't.jsonl');
  writeFileSync(transcript_path, ['{"cut', ...lines, '{"type":"user","timestamp":"2026-11-07T00:00:01Z"}'].join('\n') + '\n');
  return { dir, input: { session_id: 's1', hook_event_name: 'UserPromptSubmit', transcript_path } };
};
const at = (ms) => () => T0 + ms;

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('gap over 1 h and context over 100K: blocks once with the cost, the resend passes', () => {
  const { dir, input } = setup([rec()]);
  const out = onPrompt(input, { dir, env, now: at(HOUR + 60000) });
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('195K') && out.reason.includes('$1.56') && out.reason.includes('61분'), out.reason);
  assert.ok(out.reason.includes('새 세션') && out.reason.includes('다시 보내'), out.reason);
  assert.equal(onPrompt(input, { dir, env, now: at(HOUR + 120000) }), null);
});
test('unparsable timestamp or a session id with path characters: no block', () => {
  const bad = setup([rec({ timestamp: 'x' })]);
  assert.equal(onPrompt(bad.input, { dir: bad.dir, env, now: at(2 * HOUR) }), null);
  const { dir, input } = setup([rec()]);
  assert.equal(onPrompt({ ...input, session_id: '../x' }, { dir, env, now: at(2 * HOUR) }), null);
});
test('a later gap blocks again', () => {
  const { dir, input } = setup([rec()]);
  onPrompt(input, { dir, env, now: at(2 * HOUR) });
  writeFileSync(input.transcript_path, rec({ timestamp: new Date(T0 + 3 * HOUR).toISOString() }) + '\n');
  assert.equal(onPrompt(input, { dir, env, now: at(5 * HOUR) }).decision, 'block');
});
test('no block: short gap, small context, sidechain-only, unattended or other entrypoint, missing transcript', () => {
  const small = rec({ message: { model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 90_000 } } });
  const runs = [
    [[rec()], HOUR, env],
    [[small], 2 * HOUR, env],
    [[rec({ isSidechain: true })], 2 * HOUR, env],
    [[rec()], 2 * HOUR, { ...env, CLAUDE_CODE_SESSION_ATTENDED: '0' }],
    [[rec()], 2 * HOUR, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }],
  ];
  for (const [lines, gap, e] of runs) { const { dir, input } = setup(lines); assert.equal(onPrompt(input, { dir, env: e, now: at(gap) }), null); }
  const { dir, input } = setup([rec()]);
  assert.equal(onPrompt({ ...input, transcript_path: join(dir, 'none.jsonl') }, { dir, env, now: at(2 * HOUR) }), null);
});
test('unknown model: blocks without a dollar figure', () => {
  const { dir, input } = setup([rec({ message: { model: 'claude-haiku-5-5', usage: { input_tokens: 200_000 } } })]);
  const out = onPrompt(input, { dir, env, now: at(2 * HOUR) });
  assert.equal(out.decision, 'block'); assert.ok(!out.reason.includes('$'));
});
test('agent-hooks: a stale block wins over main-pick; otherwise main-pick runs', async () => {
  const { dir, input } = setup([rec()]);
  const blocked = JSON.parse((await evaluate(input, { dir, env, now: at(2 * HOUR) })).output);
  assert.equal(blocked.decision, 'block');
  const fresh = setup([]);
  const h = JSON.parse((await evaluate(fresh.input, { dir: fresh.dir, env, now: at(0) })).output).hookSpecificOutput;
  assert.ok(h.additionalContext.includes('main-pick.mjs'));
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
