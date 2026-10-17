// Self-check: node orchestration-guard.test.js
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const fs = require('fs');
const os = require('os');

const guard = path.join(__dirname, 'orchestration-guard.js');
const on = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-on-')); // project that imports the document
fs.writeFileSync(path.join(on, 'CLAUDE.md'), '@~/.claude/ORCHESTRATION.md\n');
const off = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-off-')); // project that does not
let n = 0;
const session = () => `test-${process.pid}-${Date.now()}-${n++}`;
const fire = (input, mode) => {
  const out = execFileSync('node', mode ? [guard, mode] : [guard], { input: JSON.stringify(input), encoding: 'utf8' });
  return out ? JSON.parse(out) : null;
};
const pre = (s, tool, tool_input = {}, extra = {}) =>
  fire({ session_id: s, cwd: on, prompt_id: 'p1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input, ...extra }, extra.mode);
const decision = (o) => o && o.hookSpecificOutput.permissionDecision;

// a project without the import is never blocked
let s0 = session();
for (let i = 0; i < 20; i++) assert.strictEqual(pre(s0, 'Grep', {}, { cwd: off }), null);

// subagent calls always pass
let s = session();
for (let i = 0; i < 20; i++) assert.strictEqual(pre(s, 'Grep', {}, { agent_id: 'a1', agent_type: 'investigator' }), null);

// main: blocked on call 9, then again on call 17
s = session();
const hits = [];
for (let i = 1; i <= 17; i++) if (pre(s, 'Grep')) hits.push(i);
assert.deepStrictEqual(hits, [9, 17]);

// default mode is ask, argument switches to deny
s = session();
for (let i = 1; i <= 8; i++) pre(s, 'Grep');
assert.strictEqual(decision(pre(s, 'Grep')), 'ask');
s = session();
for (let i = 1; i <= 8; i++) pre(s, 'Grep');
assert.strictEqual(decision(pre(s, 'Grep', {}, { mode: 'deny' })), 'deny');

// a delegation resets the count; a new prompt starts a fresh count
s = session();
pre(s, 'Agent');
for (let i = 1; i <= 8; i++) assert.strictEqual(pre(s, 'Grep'), null);
assert.strictEqual(decision(pre(s, 'Grep')), 'ask');
pre(s, 'SendMessage');
for (let i = 1; i <= 8; i++) assert.strictEqual(pre(s, 'Grep'), null);
assert.strictEqual(decision(pre(s, 'Grep')), 'ask');
for (let i = 1; i <= 8; i++) assert.strictEqual(pre(s, 'Grep', {}, { prompt_id: 'p2' }), null);
assert.strictEqual(decision(pre(s, 'Grep', {}, { prompt_id: 'p2' })), 'ask');

// git commands and small edits to already-read files are not counted
s = session();
pre(s, 'Read', { file_path: 'C:/x/a.txt' }); // 1 direct
for (let i = 0; i < 20; i++) {
  assert.strictEqual(pre(s, 'Bash', { command: 'git status' }), null);
  assert.strictEqual(pre(s, 'Edit', { file_path: 'c:\\x\\A.txt', old_string: 'a', new_string: 'b\nc' }), null);
}
for (let i = 2; i <= 8; i++) assert.strictEqual(pre(s, 'Edit', { file_path: 'C:/x/unread.txt', old_string: 'a', new_string: 'b' }), null);
assert.strictEqual(decision(pre(s, 'Edit', { file_path: 'C:/x/a.txt', old_string: 'a', new_string: '1\n2\n3\n4\n5\n6' })), 'ask');

// Stop: blocks once when over budget since the last delegation and no notice this turn
s = session();
const stop = (extra) => fire({ session_id: s, cwd: on, prompt_id: 'p1', hook_event_name: 'Stop', ...extra });
assert.strictEqual(stop({ last_assistant_message: 'done' }), null); // under budget
pre(s, 'Agent');
for (let i = 1; i <= 9; i++) pre(s, 'Grep');
assert.strictEqual(stop({ last_assistant_message: 'done' }).decision, 'block'); // an earlier delegation does not exempt
assert.strictEqual(stop({ last_assistant_message: 'done', stop_hook_active: true }), null);
assert.strictEqual(stop({ last_assistant_message: 'Delegation exception: sequential work' }), null);

// Stop: a notice earlier in this prompt's turn counts; one from a previous prompt does not
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const transcript = (entries) => {
  const f = path.join(on, `t-${n++}.jsonl`);
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return f;
};
const turn = { type: 'user', promptId: 'p1' };
assert.strictEqual(stop({ last_assistant_message: 'done', transcript_path: transcript([turn, say('Delegation exception: x'), say('done')]) }), null);
assert.strictEqual(stop({ last_assistant_message: 'done', transcript_path: transcript([say('Delegation exception: x'), turn, say('done')]) }).decision, 'block');
assert.strictEqual(stop({ last_assistant_message: 'done', transcript_path: path.join(on, 'missing.jsonl') }).decision, 'block');

// PreToolUse: a notice earlier in this prompt's turn lets direct calls through; one from a previous prompt does not
s = session();
const noted = { transcript_path: transcript([turn, say('Delegation exception: x')]) };
for (let i = 1; i <= 20; i++) assert.strictEqual(pre(s, 'Grep', {}, noted), null);
s = session();
const stale = { transcript_path: transcript([say('Delegation exception: x'), turn]) };
for (let i = 1; i <= 8; i++) pre(s, 'Grep', {}, stale);
assert.strictEqual(decision(pre(s, 'Grep', {}, stale)), 'ask');

console.log('ok');
