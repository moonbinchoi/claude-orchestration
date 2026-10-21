import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onDispatch } from './router-guard.mjs';
import { evaluate } from './agent-hooks.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const conf = (p) => { const v = Object.values(p); const n = v.length; return (Math.max(...v) - 1 / n) / (1 - 1 / n); };
const reply = (p) => {
  const choice = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  return new Response(JSON.stringify({ model: 'jev-test', answers: { model: { choice, probabilities: p, confidence: conf(p) } }, usage: { input_tokens: 1, output_tokens: 1 } }));
};
const HAIKU = { haiku: 0.9, sonnet: 0.05, opus: 0.05 };
const SONNET = { haiku: 0.05, sonnet: 0.9, opus: 0.05 };
const OPUS = { haiku: 0.05, sonnet: 0.05, opus: 0.9 };
const fetchOf = (p) => { const f = async () => { f.calls++; return reply(p); }; f.calls = 0; return f; };
const setup = (config) => {
  const dir = mkdtempSync(join(tmpdir(), 'router-test-'));
  const agentsDir = join(dir, 'agents'); mkdirSync(agentsDir);
  writeFileSync(join(agentsDir, 'analyst.md'), '---\nname: analyst\nmodel: opus\n---\nbody');
  writeFileSync(join(agentsDir, 'worker.md'), '---\nname: worker\nmodel: haiku\n---\nbody');
  writeFileSync(join(agentsDir, 'odd.md'), '---\nname: odd\nmodel: inherit\n---\nbody');
  if (config) writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return { dir, agentsDir };
};
const input = (ti, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_use_id: 'tu1', tool_input: { description: 'd', prompt: 'Summary: Rename one variable as instructed.\nGoal: x', subagent_type: 'analyst', ...ti }, ...extra });
const logOf = (dir) => readFileSync(join(dir, 'router.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const go = (inp, p, config) => { const s = setup(config); const f = fetchOf(p); return onDispatch(inp, { fetchImpl: f, ...s }).then((out) => ({ out, f, ...s })); };

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('lowers opus agent to sonnet via updatedInput with the whole tool_input', async () => {
  const inp = input({});
  const { out, dir } = await go(inp, SONNET);
  const h = out.hookSpecificOutput;
  assert.equal(h.hookEventName, 'PreToolUse'); assert.equal(h.permissionDecision, 'allow');
  assert.deepEqual(h.updatedInput, { ...inp.tool_input, model: 'sonnet' });
  const [r] = logOf(dir);
  assert.equal(r.rule_model, 'opus'); assert.equal(r.jev_model, 'sonnet'); assert.equal(r.applied_model, 'sonnet'); assert.equal(r.tool_use_id, 'tu1');
  assert.ok(!JSON.stringify(r).includes('Goal'));
});
test('explicit tool_input.model is the rule tier', async () => {
  const { out } = await go(input({ model: 'sonnet', subagent_type: 'worker' }), HAIKU);
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'haiku');
});
test('equal or higher Jev tier: no output', async () => {
  assert.equal((await go(input({}), OPUS)).out, null);
  assert.equal((await go(input({ subagent_type: 'worker' }), OPUS)).out, null);
});
test('analyst floor: Jev haiku is raised to sonnet before comparison', async () => {
  assert.equal((await go(input({}), HAIKU)).out.hookSpecificOutput.updatedInput.model, 'sonnet');
});
test('skips make no Jev call and log the reason', async () => {
  const skips = {
    no_summary: input({ prompt: 'Goal: do it' }),
    model_lock: input({ prompt: 'Summary: Rename a variable.\nModel-lock: user asked for opus' }),
    fable: input({ model: 'fable' }),
    fork: input({ subagent_type: 'fork' }),
    rule_unknown: input({ subagent_type: 'odd' }),
    sensitive: input({ prompt: 'Summary: Review the deploy script for errors.' }),
  };
  for (const [reason, inp] of Object.entries(skips)) {
    const { out, f, dir } = await go(inp, HAIKU);
    assert.equal(out, null, reason); assert.equal(f.calls, 0, reason); assert.equal(logOf(dir)[0].skip, reason, reason);
  }
  assert.equal((await go(input({ subagent_type: 'nofile' }), HAIKU)).f.calls, 0);
});
test('sensitive: plurals and other word forms skip; "authored" does not', async () => {
  for (const s of ['Rotate the leaked secrets in the config.', 'Audit stored credentials.', 'Fix file permissions on the cache dir.', 'Run the database migrations.', 'Deleting old rows from the orders table.', 'Update the OAuth token flow.', 'Check the auth middleware.']) {
    const { f, dir } = await go(input({ prompt: `Summary: ${s}` }), SONNET);
    assert.equal(f.calls, 0, s); assert.equal(logOf(dir)[0].skip, 'sensitive', s);
  }
  const authored = await go(input({ prompt: 'Summary: Summarise the notes the author authored last week.' }), SONNET);
  assert.ok(authored.f.calls >= 1); assert.notEqual(logOf(authored.dir)[0].skip, 'sensitive'); // >= 1: jev-tier may add a shuffled side call
});
test('rule tier at the floor: no Jev call (worker haiku, analyst on explicit sonnet)', async () => {
  for (const ti of [{ subagent_type: 'worker' }, { model: 'sonnet' }]) {
    const { out, f, dir } = await go(input(ti), HAIKU);
    assert.equal(out, null); assert.equal(f.calls, 0); assert.equal(logOf(dir)[0].skip, 'at_floor');
  }
});
test('project agent overrides the user agent; a model line outside the frontmatter is ignored', async () => {
  const s = setup();
  const proj = join(s.dir, 'proj'); mkdirSync(join(proj, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(proj, '.claude', 'agents', 'analyst.md'), '---\nname: analyst\nmodel: sonnet\n---\nbody');
  const f = fetchOf(HAIKU);
  assert.equal(await onDispatch(input({}, { cwd: proj }), { fetchImpl: f, ...s }), null); // project sonnet = analyst floor: never raised to the user file's opus
  assert.equal(f.calls, 0);
  writeFileSync(join(proj, '.claude', 'agents', 'analyst.md'), '---\nname: analyst\n---\nmodel: haiku in the body');
  await onDispatch(input({}, { cwd: proj }), { fetchImpl: f, ...s });
  assert.equal(logOf(s.dir).at(-1).skip, 'rule_unknown');
});
test('summary only counts in the first 3 non-empty lines', async () => {
  const { out, f } = await go(input({ prompt: 'a\n\nb\nc\nSummary: Rename a variable.' }), SONNET);
  assert.equal(out, null); assert.equal(f.calls, 0);
  assert.ok((await go(input({ prompt: '\nGoal: g\nsummary: Rename a variable.' }), SONNET)).out);
});
test('Jev failure: no output', async () => {
  const s = setup();
  const f = async () => new Response('x', { status: 500 });
  assert.equal(await onDispatch(input({}), { fetchImpl: f, ...s }), null);
  assert.match(logOf(s.dir)[0].skip, /^jev: /);
});
test('mode log computes and logs but never outputs; off does nothing', async () => {
  const a = await go(input({}), SONNET, { router: { mode: 'log' } });
  assert.equal(a.out, null); assert.equal(logOf(a.dir)[0].jev_model, 'sonnet'); assert.equal(logOf(a.dir)[0].applied_model, null);
  const b = await go(input({}), SONNET, { router: { mode: 'off' } });
  assert.equal(b.out, null); assert.equal(b.f.calls, 0);
});
test('agent-hooks: router output survives merge and the registry records the dispatched model', async () => {
  const s = setup();
  const f = fetchOf(SONNET);
  const loader = async (file) => (file === 'router-guard.mjs' ? { onDispatch: (i, o) => onDispatch(i, { ...o, agentsDir: s.agentsDir }) } : import(`./${file}`));
  const { output } = await evaluate(input({}), { fetchImpl: f, dir: s.dir, loader });
  const h = JSON.parse(output).hookSpecificOutput;
  assert.equal(h.permissionDecision, 'allow'); assert.equal(h.updatedInput.model, 'sonnet');
  const reg = readFileSync(join(s.dir, 'registry.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(reg.find((e) => e.event === 'dispatch').model, 'sonnet');
});
test('agent-hooks: a deny from another guard wins over the router', async () => {
  const s = setup();
  const deny = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'dup' } };
  const loader = async (file) => {
    if (file === 'router-guard.mjs') return { onDispatch: (i, o) => onDispatch(i, { ...o, agentsDir: s.agentsDir }) };
    if (file === 'dispatch-guard.mjs') return { onDispatch: async () => ({ output: deny }) };
    return import(`./${file}`);
  };
  const { output } = await evaluate(input({}), { fetchImpl: fetchOf(SONNET), dir: s.dir, loader });
  const h = JSON.parse(output).hookSpecificOutput;
  assert.equal(h.permissionDecision, 'deny'); assert.ok(!('updatedInput' in h));
});
test('agent-hooks: broken router module is ignored', async () => {
  const s = setup();
  const loader = async (file) => { if (file === 'router-guard.mjs') throw new Error('x'); return import(`./${file}`); };
  const { output } = await evaluate(input({}), { fetchImpl: fetchOf(SONNET), dir: s.dir, loader });
  assert.equal(output, null);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
