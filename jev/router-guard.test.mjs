import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onDispatch } from './router-guard.mjs';
import { evaluate } from './agent-hooks.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const conf = (p) => { const v = Object.values(p); const n = v.length; return (Math.max(...v) - 1 / n) / (1 - 1 / n); };
// s: effort Score expected value (1 -> medium); null leaves the effort answer out
const reply = (p, s = 1) => {
  const choice = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  const effort = s === null ? {} : { effort: { type: 'score', score: s, confidence: 0.5, legend: [], probabilities: { 0: 0.1, 1: 0.2, 2: 0.4, 3: 0.2, 4: 0.1 } } };
  return new Response(JSON.stringify({ model: 'jev-test', answers: { model: { choice, probabilities: p, confidence: conf(p) }, ...effort }, usage: { input_tokens: 1, output_tokens: 1 } }));
};
const HAIKU = { haiku: 0.9, sonnet: 0.05, opus: 0.05 };
const SONNET = { haiku: 0.05, sonnet: 0.9, opus: 0.05 };
const OPUS = { haiku: 0.05, sonnet: 0.05, opus: 0.9 };
const fetchOf = (p, s) => { const f = async () => { f.calls++; return reply(p, s); }; f.calls = 0; return f; };
const setup = (config) => {
  const dir = mkdtempSync(join(tmpdir(), 'router-test-'));
  const agentsDir = join(dir, 'agents'); mkdirSync(agentsDir);
  writeFileSync(join(agentsDir, 'analyst.md'), '---\nname: analyst\nmodel: opus\neffort: high\n---\nbody');
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
    fable: input({ model: 'fable' }),
    fork: input({ subagent_type: 'fork' }),
    sensitive: input({ prompt: 'Summary: Review the deploy script for errors.' }),
  };
  for (const [reason, inp] of Object.entries(skips)) {
    const { out, f, dir } = await go(inp, HAIKU);
    assert.equal(out, null, reason); assert.equal(f.calls, 0, reason); assert.equal(logOf(dir)[0].skip, reason, reason);
  }
  for (const ti of [{ subagent_type: 'odd' }, { subagent_type: 'worker' }]) { // unknown rule or at the floor: sensitive still wins, no shadow call
    const { f, dir } = await go(input({ ...ti, prompt: 'Summary: Review the deploy script for errors.' }), HAIKU);
    assert.equal(f.calls, 0); assert.equal(logOf(dir)[0].skip, 'sensitive');
  }
});
test('rule unknown: Jev is called in shadow and logged, never applied', async () => {
  for (const type of ['odd', 'nofile']) {
    const { out, f, dir } = await go(input({ subagent_type: type }), HAIKU);
    const rec = logOf(dir)[0];
    assert.equal(out, null, type); assert.ok(f.calls >= 1, type);
    assert.equal(rec.skip, 'rule_unknown', type); assert.equal(rec.jev_model, 'haiku', type); assert.equal(rec.applied_model, null, type);
  }
});
test('sensitive: plurals and other word forms skip; "authored" does not', async () => {
  for (const s of ['Rotate the leaked secrets in the config.', 'Audit stored credentials.', 'Fix file permissions on the cache dir.', 'Run the database migrations.', 'Deleting old rows from the orders table.', 'Update the OAuth token flow.', 'Check the auth middleware.']) {
    const { f, dir } = await go(input({ prompt: `Summary: ${s}` }), SONNET);
    assert.equal(f.calls, 0, s); assert.equal(logOf(dir)[0].skip, 'sensitive', s);
  }
  const authored = await go(input({ prompt: 'Summary: Summarise the notes the author authored last week.' }), SONNET);
  assert.ok(authored.f.calls >= 1); assert.notEqual(logOf(authored.dir)[0].skip, 'sensitive'); // >= 1: jev-tier may add a shuffled side call
});
test('rule tier at the floor: Jev in shadow, never applied (worker haiku, analyst on explicit sonnet)', async () => {
  for (const [ti, jev] of [[{ subagent_type: 'worker' }, 'haiku'], [{ model: 'sonnet' }, 'sonnet']]) {
    const { out, f, dir } = await go(input(ti), HAIKU);
    const rec = logOf(dir)[0];
    assert.equal(out, null); assert.ok(f.calls >= 1); assert.equal(rec.skip, 'at_floor'); assert.equal(rec.jev_model, jev); assert.equal(rec.applied_model, null);
  }
});
test('project agent is found from a project subfolder', async () => {
  const s = setup();
  const proj = join(s.dir, 'proj'); mkdirSync(join(proj, '.claude', 'agents'), { recursive: true });
  const sub = join(proj, 'projects', 'shop'); mkdirSync(sub, { recursive: true });
  writeFileSync(join(proj, '.claude', 'agents', 'source-reader.md'), '---\nname: source-reader\nmodel: opus\n---\nbody');
  await onDispatch(input({ subagent_type: 'source-reader' }, { cwd: sub }), { fetchImpl: fetchOf(SONNET), ...s });
  assert.equal(logOf(s.dir).at(-1).rule_model, 'opus');
});
test('project agent overrides the user agent; a model line outside the frontmatter is ignored', async () => {
  const s = setup();
  const proj = join(s.dir, 'proj'); mkdirSync(join(proj, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(proj, '.claude', 'agents', 'analyst.md'), '---\nname: analyst\nmodel: sonnet\n---\nbody');
  const f = fetchOf(HAIKU);
  assert.equal(await onDispatch(input({}, { cwd: proj }), { fetchImpl: f, ...s }), null); // project sonnet = analyst floor: never raised to the user file's opus
  assert.equal(logOf(s.dir).at(-1).rule_model, 'sonnet');
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
test('shadow Jev failure: the shadow reason stays, no jev_model, no output', async () => {
  const s = setup();
  const f = async () => new Response('x', { status: 500 });
  assert.equal(await onDispatch(input({ subagent_type: 'worker' }), { fetchImpl: f, ...s }), null);
  const rec = logOf(s.dir)[0];
  assert.equal(rec.skip, 'at_floor'); assert.equal(rec.jev_model, null); assert.equal(rec.applied_model, null);
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

const DENY = 'Model-lock must name a model: "Model-lock: <haiku|sonnet|opus|fable>". Add the model and dispatch again.';
const lockP = (line, nl = '\n') => `Summary: Rename a variable.${nl}${line}${nl}Goal: x`;
test('lock without a model is denied, no Jev call', async () => {
  for (const line of ['Model-lock: user asked for opus', 'Model-lock:', 'Model-lock: opus.', 'Model-lock: opus-4']) {
    const { out, f, dir } = await go(input({ prompt: lockP(line) }), HAIKU);
    assert.equal(out?.hookSpecificOutput.permissionDecision, 'deny', line); assert.equal(out.hookSpecificOutput.permissionDecisionReason, DENY);
    assert.equal(f.calls, 0); assert.equal(logOf(dir)[0].skip, 'model_lock_invalid');
  }
});
test('lock with a model dispatches that model, even over an explicit model and without Summary', async () => {
  for (const ti of [{ prompt: lockP('Model-lock: sonnet') }, { model: 'opus', prompt: lockP('Model-lock: haiku — user chose') }, { prompt: 'Goal: x\nModel-lock: sonnet' }]) {
    const { out, f, dir } = await go(input(ti), HAIKU);
    const want = /haiku/.test(ti.prompt) ? 'haiku' : 'sonnet';
    assert.deepEqual(out?.hookSpecificOutput.updatedInput, { ...input(ti).tool_input, model: want });
    assert.equal(f.calls, 0); const r = logOf(dir)[0]; assert.equal(r.skip, 'model_lock'); assert.equal(r.lock_model, want); assert.equal(r.applied_model, want);
  }
});
test('lock model is case-insensitive and lowercased; Model-lock:opus without space is valid', async () => {
  assert.equal((await go(input({ prompt: lockP('Model-lock: Opus') }), HAIKU)).out?.hookSpecificOutput.updatedInput.model, 'opus');
  assert.equal((await go(input({ prompt: lockP('Model-lock:opus') }), HAIKU)).out?.hookSpecificOutput.updatedInput.model, 'opus');
});
test('CRLF lock line is valid; lock line after the summary block is still found', async () => {
  assert.equal((await go(input({ prompt: lockP('Model-lock: sonnet', '\r\n') }), HAIKU)).out?.hookSpecificOutput.updatedInput.model, 'sonnet');
  assert.equal((await go(input({ prompt: 'Summary: s\nGoal: g\nContext: c\nScope: x\nModel-lock: sonnet' }), HAIKU)).out?.hookSpecificOutput.updatedInput.model, 'sonnet');
});
test('only the first lock line counts', async () => {
  assert.equal((await go(input({ prompt: lockP('Model-lock: why\nModel-lock: sonnet') }), HAIKU)).out?.hookSpecificOutput.permissionDecision, 'deny');
});
test('lock in log mode: logged, no output; off and fork: lock ignored', async () => {
  const a = await go(input({ prompt: lockP('Model-lock: why') }), HAIKU, { router: { mode: 'log' } });
  assert.equal(a.out, null); assert.equal(logOf(a.dir)[0].skip, 'model_lock_invalid');
  const b = await go(input({ prompt: lockP('Model-lock: sonnet') }), HAIKU, { router: { mode: 'log' } });
  assert.equal(b.out, null); assert.equal(logOf(b.dir)[0].lock_model, 'sonnet'); assert.equal(logOf(b.dir)[0].applied_model, null);
  assert.equal((await go(input({ prompt: lockP('Model-lock: why') }), HAIKU, { router: { mode: 'off' } })).out, null);
  const c = await go(input({ subagent_type: 'fork', prompt: lockP('Model-lock: why') }), HAIKU);
  assert.equal(c.out, null); assert.equal(logOf(c.dir)[0].skip, 'fork');
});
test('every record carries cwd', async () => {
  const a = await go(input({}, { cwd: '/e/Study/Inflearn' }), SONNET); assert.equal(logOf(a.dir)[0].cwd, '/e/Study/Inflearn');
  const b = await go(input({ subagent_type: 'fork' }), SONNET); assert.equal(logOf(b.dir)[0].cwd, null);
});
test('agent-hooks: a lock deny is not registered', async () => {
  const s = setup();
  const loader = async (file) => (file === 'router-guard.mjs' ? { onDispatch: (i, o) => onDispatch(i, { ...o, agentsDir: s.agentsDir }) } : import(`./${file}`));
  const { output } = await evaluate(input({ prompt: lockP('Model-lock: why') }), { fetchImpl: fetchOf(SONNET), dir: s.dir, loader });
  assert.equal(JSON.parse(output).hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(!existsSync(join(s.dir, 'registry.jsonl')) || !readFileSync(join(s.dir, 'registry.jsonl'), 'utf8').includes('"dispatch"'));
});

test('effort: lower Jev effort is would_apply only, effort never changed in output', async () => {
  const { out, dir } = await go(input({ effort: 'high' }), SONNET); // score 1 -> medium
  assert.equal(out.hookSpecificOutput.updatedInput.effort, 'high');
  const r = logOf(dir)[0]; assert.equal(r.rule_effort, 'high'); assert.equal(r.jev_effort, 'medium'); assert.equal(r.effort_would_apply, 'medium');
  const noEff = await go(input({}), SONNET); assert.ok(!('effort' in noEff.out.hookSpecificOutput.updatedInput));
});
test('effort: rule effort from frontmatter; passed effort wins; missing -> null', async () => {
  assert.equal(logOf((await go(input({}), SONNET)).dir)[0].rule_effort, 'high');
  assert.equal(logOf((await go(input({ effort: 'LOW' }), SONNET)).dir)[0].rule_effort, 'low');
  const w = logOf((await go(input({ model: 'sonnet', subagent_type: 'worker' }), HAIKU)).dir)[0];
  assert.equal(w.rule_effort, null); assert.equal(w.effort_would_apply, null); assert.equal(w.jev_effort, 'medium');
});
test('effort: equal or higher Jev effort, or an odd rule effort, gives no would_apply', async () => {
  for (const e of ['low', 'medium', 'weird']) assert.equal(logOf((await go(input({ effort: e }), SONNET)).dir)[0].effort_would_apply, null, e);
});
test('effort: null on rule_unknown, lock, skips and Jev failure', async () => {
  const cases = [input({ subagent_type: 'odd' }), input({ prompt: lockP('Model-lock: sonnet') }), input({ prompt: 'Goal: x' })];
  for (const c of cases) { const r = logOf((await go(c, SONNET)).dir)[0]; assert.equal(r.rule_effort, null); assert.equal(r.jev_effort, null); assert.equal(r.effort_would_apply, null); }
  const s = setup(); await onDispatch(input({}), { fetchImpl: async () => new Response('x', { status: 500 }), ...s });
  assert.equal(logOf(s.dir)[0].jev_effort, null);
});
test('bad effort answer keeps model routing', async () => {
  const s = setup(); const out = await onDispatch(input({}), { fetchImpl: fetchOf(SONNET, 9), ...s });
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'sonnet'); assert.equal(logOf(s.dir)[0].jev_effort, null);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
