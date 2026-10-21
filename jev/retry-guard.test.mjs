import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFailure } from './failure-cause.mjs';
import { append } from './registry.mjs';
import { afterEvent, judge, onDispatch } from './retry-guard.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const tmp = () => mkdtempSync(join(tmpdir(), 'rt-test-'));
const lines = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const cfg = (dir, mode) => writeFileSync(join(dir, 'config.json'), JSON.stringify({ retryGuard: { mode } }));

const fail = (text) => classifyFailure({ text: 'BLOCKED: ' + text, status: 'BLOCKED', launchStatus: null });
const dsp = (id, text, extra = {}) => ({ session_id: 's1', tool_use_id: id, agent_id: 'a' + id, description: 'desc ' + id, ts: new Date().toISOString(), failure: text ? fail(text) : null, verdict: null, ...extra });
const NEAR_A = 'build failed in module alpha with exit code', NEAR_B = 'build failed in module beta with exit code';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('not failed -> null', async () => assert.equal(await judge(dsp('t1', null), null, {}), null));
test('env_auth subkinds and precedence over same cause', async () => {
  for (const [t, sub] of [['401 unauthorized', 'auth'], ['permission denied', 'permission'], ['ENOTFOUND host', 'network'], ['command not found', 'missing_tool']]) {
    const r = await judge(dsp('t2', t), dsp('t1', t), {});
    assert.deepEqual([r.class, r.subkind, r.verdict, r.sig_equal], ['env_auth', sub, 'would_deny', null]);
  }
});
test('transient -> env_auth/transient would_flag', async () => {
  const r = await judge(dsp('t1', 'error 429 rate limit'), null, {});
  assert.deepEqual([r.class, r.subkind, r.verdict], ['env_auth', 'transient', 'would_flag']);
});
test('no failed prior -> new_cause chain 1; prior without failure too', async () => {
  const r = await judge(dsp('t1', 'build failed'), null, {}); assert.deepEqual([r.class, r.chain_len, r.verdict], ['new_cause', 1, 'pass']);
  assert.equal((await judge(dsp('t2', 'build failed'), dsp('t1', null), {})).class, 'new_cause');
});
test('same signature -> same_cause_repeat; chain_len follows the prior', async () => {
  const r = await judge(dsp('t2', 'build failed at step 3'), dsp('t1', 'build failed at step 9', { verdict: { chain_len: 2 } }), {});
  assert.deepEqual([r.class, r.sig_equal, r.verdict, r.chain_len, r.prior_tool_use_id], ['same_cause_repeat', true, 'would_deny', 3, 't1']);
});
test('low overlap -> new_cause', async () => {
  const r = await judge(dsp('t2', 'disk is full'), dsp('t1', 'build failed in alpha'), {});
  assert.equal(r.class, 'new_cause'); assert.ok(r.jaccard < 0.5);
});
test('near pair with different signatures -> unknown, pass', async () => {
  const r = await judge(dsp('t2', NEAR_B), dsp('t1', NEAR_A), {});
  assert.deepEqual([r.class, r.verdict, r.sig_equal], ['unknown', 'pass', false]); assert.ok(r.jaccard >= 0.5);
});
test('missing cause -> unknown with jev_skipped', async () => {
  const a = await judge({ ...dsp('t2', null), failure: classifyFailure({ text: 'BLOCKED', status: 'BLOCKED' }) }, dsp('t1', 'build failed'), {});
  assert.deepEqual([a.class, a.jev_skipped], ['unknown', 'no_cause']);
});

// ---- afterEvent ----
const seed = (dir, id, text, over = {}) => {
  append(dir, 'registry.jsonl', { ts: new Date().toISOString(), event: 'dispatch', session_id: 's1', tool_use_id: id, description: 'desc ' + id, same_as: over.same_as ?? null, prompt: 'p' });
  if (over.link !== false) append(dir, 'registry.jsonl', { ts: new Date().toISOString(), event: 'link', session_id: 's1', tool_use_id: id, agent_id: 'a' + id, resolved_model: null, launch_status: 'completed' });
  if (over.stop !== false) append(dir, 'registry.jsonl', { ts: new Date().toISOString(), event: 'stop', session_id: 's1', agent_id: 'a' + id, status: 'BLOCKED', failure: fail(text) });
};
const ev = (via, id) => (via === 'stop' ? { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'a' + id } : { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: id });
test('afterEvent waits for both link and stop, judges once, writes log and registry event', async () => {
  const dir = tmp(); seed(dir, 't1', 'build failed', { stop: false });
  assert.equal(await afterEvent(ev('link', 't1'), { dir, via: 'link' }), null); assert.equal(lines(dir, 'retry-guard.jsonl').length, 0);
  append(dir, 'registry.jsonl', { ts: new Date().toISOString(), event: 'stop', session_id: 's1', agent_id: 'at1', status: 'BLOCKED', failure: fail('build failed') });
  await afterEvent(ev('stop', 't1'), { dir, via: 'stop' });
  await afterEvent(ev('link', 't1'), { dir, via: 'link' }); await afterEvent(ev('stop', 't1'), { dir, via: 'stop' });
  const [r] = lines(dir, 'retry-guard.jsonl'); assert.equal(lines(dir, 'retry-guard.jsonl').length, 1);
  assert.deepEqual([r.via, r.mode, r.class], ['stop', 'log', 'new_cause']);
  assert.deepEqual(lines(dir, 'registry.jsonl').filter((e) => e.event === 'retry_verdict').map((e) => [e.tool_use_id, e.class, e.verdict]), [['t1', 'new_cause', 'pass']]);
});
test('afterEvent output: enforce + link only, flagged verdicts only', async () => {
  const mk = (mode, text = 'permission denied') => { const dir = tmp(); cfg(dir, mode); seed(dir, 't1', text); return dir; };
  const out = await afterEvent(ev('link', 't1'), { dir: mk('enforce'), via: 'link' });
  assert.match(out.hookSpecificOutput.additionalContext, /^Retry check: "desc t1" failed on an environment problem \(permission\)\. Fix the environment first/); assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(await afterEvent(ev('stop', 't1'), { dir: mk('enforce'), via: 'stop' }), null);
  assert.equal(await afterEvent(ev('link', 't1'), { dir: mk('log'), via: 'link' }), null);
  assert.equal(await afterEvent(ev('link', 't1'), { dir: mk('enforce', 'build failed'), via: 'link' }), null);
  assert.match((await afterEvent(ev('link', 't1'), { dir: mk('enforce', 'HTTP 429 rate limit'), via: 'link' })).hookSpecificOutput.additionalContext, /transient error/);
  const off = mk('off'); assert.equal(await afterEvent(ev('link', 't1'), { dir: off, via: 'link' }), null); assert.equal(lines(off, 'retry-guard.jsonl').length, 0);
});
test('afterEvent: same_as prior found in the registry', async () => {
  const dir = tmp(); cfg(dir, 'enforce'); seed(dir, 't1', 'build failed at step 3'); seed(dir, 't2', 'build failed at step 4', { same_as: 't1' });
  const out = await afterEvent(ev('link', 't2'), { dir, via: 'link' });
  const r = lines(dir, 'retry-guard.jsonl').at(-1); assert.deepEqual([r.class, r.prior_tool_use_id, r.chain_len], ['same_cause_repeat', 't1', 2]);
  assert.match(out.hookSpecificOutput.additionalContext, /^Retry check: "desc t2" failed again with the same cause as the previous attempt \(\d\d:\d\d\)\. Repeating it will not help/);
});

test('M5: link failure without agent_id is judged at the link only', async () => {
  const dir = tmp(); const t = new Date().toISOString();
  append(dir, 'registry.jsonl', { ts: t, event: 'dispatch', session_id: 's1', tool_use_id: 't1', description: 'd', same_as: null });
  append(dir, 'registry.jsonl', { ts: t, event: 'link', session_id: 's1', tool_use_id: 't1', agent_id: null, launch_status: 'error', failure: fail('HTTP 429 rate limit exceeded') });
  assert.equal(await afterEvent({ session_id: 's1', tool_use_id: 't1', agent_id: 'x' }, { dir, via: 'stop' }), null);
  await afterEvent(ev('link', 't1'), { dir, via: 'link' }); await afterEvent(ev('link', 't1'), { dir, via: 'link' });
  assert.deepEqual(lines(dir, 'retry-guard.jsonl').map((r) => [r.class, r.subkind, r.via]), [['env_auth', 'transient', 'link']]);
});

// ---- onDispatch ----
const flaggedPrior = (cls, subkind, verdict) => dsp('t1', 'x failed', { verdict: { class: cls, subkind, verdict, chain_len: 1 } });
const inp = (prompt = 'do it') => ({ session_id: 's1', tool_use_id: 't9', tool_input: { prompt } });
test('onDispatch: enforce deny / flag / rerun override / log mode / unflagged', () => {
  const dir = tmp(); cfg(dir, 'enforce');
  const deny = onDispatch(inp(), { dir, priors: [flaggedPrior('same_cause_repeat', null, 'would_deny')], sameAs: 't1' }).hookSpecificOutput;
  assert.equal(deny.permissionDecision, 'deny'); assert.match(deny.permissionDecisionReason, /^Retry check: "desc t1" failed again with the same cause/);
  const flag = onDispatch(inp(), { dir, priors: [flaggedPrior('env_auth', 'transient', 'would_flag')], sameAs: 't1' }).hookSpecificOutput;
  assert.deepEqual(Object.keys(flag), ['hookEventName', 'additionalContext']); assert.match(flag.additionalContext, /^Retry check: "desc t1" failed on a transient error/);
  assert.equal(onDispatch(inp('do it\nRerun: env fixed - perms'), { dir, priors: [flaggedPrior('env_auth', 'auth', 'would_deny')], sameAs: 't1' }), null);
  assert.deepEqual(lines(dir, 'retry-guard.jsonl').map((r) => [r.via, r.verdict]), [['dispatch', 'would_deny'], ['dispatch', 'would_flag'], ['dispatch', 'rerun_override']]);
  assert.equal(onDispatch(inp(), { dir, priors: [flaggedPrior('new_cause', null, 'pass')], sameAs: 't1' }), null);
  assert.equal(onDispatch(inp(), { dir, priors: [], sameAs: 't1' }), null); assert.equal(onDispatch(inp(), { dir, priors: [flaggedPrior('env_auth', 'auth', 'would_deny')], sameAs: null }), null);
  const log = tmp(); assert.equal(onDispatch(inp(), { dir: log, priors: [flaggedPrior('env_auth', 'auth', 'would_deny')], sameAs: 't1' }), null); assert.equal(lines(log, 'retry-guard.jsonl')[0].mode, 'log');
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
