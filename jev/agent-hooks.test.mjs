import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluate } from './agent-hooks.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const answer = (p2) => ({ type: 'score', score: 2 * p2, confidence: p2, legend: ['a', 'b', 'c'], probabilities: { 0: (1 - p2) / 2, 1: (1 - p2) / 2, 2: p2 } });
const payload = (yes) => ({ model: 'jev-1.13-test', answers: { same_task: answer(yes) } });
const mockFetch = (handler) => { const f = async (url, init) => { f.calls++; f.last = JSON.parse(init.body); return handler(); }; f.calls = 0; return f; };
const fixed = (yes) => mockFetch(() => new Response(JSON.stringify(payload(yes)), { status: 200 }));
const tmp = () => mkdtempSync(join(tmpdir(), 'dg-test-'));
const cfg = (dir, mode) => writeFileSync(join(dir, 'config.json'), JSON.stringify({ dispatchGuard: { mode } }));
const lines = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const log = (dir) => lines(dir, 'dispatch-guard.jsonl');
const reg = (dir) => lines(dir, 'registry.jsonl');

let n = 0;
const base = { session_id: 's1' };
const pre = (dir, prompt, over = {}, o = {}) => {
  const { model, subagent_type = 'worker', ...rest } = over;
  const id = rest.tool_use_id ?? `toolu_${++n}`;
  return evaluate({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: id, tool_input: { description: `desc ${id}`, prompt, subagent_type, ...(model ? { model } : {}) }, ...rest }, { dir, fetchImpl: fixed(0.95), ...o })
    .then((r) => ({ ...r, id, rec: log(dir).at(-1) }));
};
const link = (dir, tool_use_id, agentId, resolvedModel = 'claude-haiku-5-5', s = 's1') =>
  evaluate({ session_id: s, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id, tool_input: {}, tool_response: { status: 'completed', agentId, resolvedModel } }, { dir });
const stop = (dir, agent_id, last_assistant_message, s = 's1') => evaluate({ session_id: s, hook_event_name: 'SubagentStop', agent_id, last_assistant_message }, { dir });
// dispatch + link (launched, still running)
const launched = async (dir, prompt, over) => { const r = await pre(dir, prompt, over); await link(dir, r.id, `a${++n}`); return r; };
// dispatch + link + stop with the given first line
const finished = async (dir, prompt, first, over, agent = `a${++n}`) => {
  const r = await pre(dir, prompt, over); await link(dir, r.id, agent); if (first) await stop(dir, agent, first); return r;
};

const P = 'Fix the flaky   test in the billing module and report.';
let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('exact duplicate of running -> would_deny (normalized prompt)', async () => {
  const dir = tmp(); await launched(dir, P);
  const r = await pre(dir, '  fix the FLAKY test in the billing module and report.  ');
  assert.equal(r.rec.verdict, 'would_deny'); assert.equal(r.rec.kind, 'duplicate_exact'); assert.equal(r.rec.exact.status, 'running'); assert.equal(r.output, null);
});
test('exact duplicate of DONE -> would_deny', async () => {
  const dir = tmp(); await finished(dir, P, 'DONE\nall good');
  assert.equal((await pre(dir, P)).rec.kind, 'duplicate_exact');
});
test('different subagent_type -> not exact', async () => {
  const dir = tmp(); await pre(dir, P);
  assert.equal((await pre(dir, P, { subagent_type: 'explorer' })).rec.verdict, 'pass');
});
test('exact after BLOCKED, same model -> would_deny escalation', async () => {
  const dir = tmp(); await finished(dir, P, '**BLOCKED**: nope', { model: 'sonnet' });
  const r = await pre(dir, P, { model: 'sonnet' });
  assert.equal(r.rec.verdict, 'would_deny'); assert.equal(r.rec.kind, 'escalation_same_brief');
});
test('exact after PARTIAL, no model on new -> would_deny escalation', async () => {
  const dir = tmp(); await finished(dir, P, 'PARTIAL', { model: 'haiku' });
  assert.equal((await pre(dir, P)).rec.kind, 'escalation_same_brief');
});
test('exact after BLOCKED, higher model -> pass', async () => {
  const dir = tmp(); await finished(dir, P, 'BLOCKED', { model: 'haiku' });
  assert.equal((await pre(dir, P, { model: 'opus' })).rec.verdict, 'pass');
});
test('prior model falls back to resolved_model from link', async () => {
  const d1 = tmp(); await finished(d1, P, 'BLOCKED', {}, 'aX'); // link resolves to haiku
  assert.equal((await pre(d1, P, { model: 'sonnet' })).rec.verdict, 'pass');
  const d2 = tmp(); await finished(d2, P, 'BLOCKED', {}, 'aY');
  assert.equal((await pre(d2, P, { model: 'haiku' })).rec.verdict, 'would_deny');
});
test('Rerun override skips checks', async () => {
  const dir = tmp(); await pre(dir, P);
  const r = await pre(dir, P + '\nRerun: previous result lost');
  assert.equal(r.rec.verdict, 'rerun_override'); assert.equal(r.rec.rerun, true);
});
test('link + stop folding gives status; unknown for no status line', async () => {
  const dir = tmp();
  await finished(dir, 'task one alpha', 'PARTIAL: half', {}, 'a1');
  await finished(dir, 'task two beta', 'Here is my answer', {}, 'a2');
  await finished(dir, 'task three gamma', null, {}, 'a3');
  assert.equal((await pre(dir, 'task one alpha')).rec.exact.status, 'PARTIAL');
  assert.equal((await pre(dir, 'task two beta')).rec.exact.status, 'unknown');
  assert.equal((await pre(dir, 'task three gamma')).rec.exact.status, 'running');
});
test('registry events have the specified shape', async () => {
  const dir = tmp(); await finished(dir, P, 'DONE', { model: 'haiku' }, 'aZ');
  const [d, l, s] = reg(dir);
  assert.deepEqual([d.event, l.event, s.event], ['dispatch', 'link', 'stop']);
  assert.equal(d.prompt, 'fix the flaky test in the billing module and report.'); assert.equal(d.prompt_sha256.length, 64);
  assert.deepEqual([l.agent_id, l.resolved_model, l.launch_status], ['aZ', 'claude-haiku-5-5', 'completed']); assert.equal(s.status, 'DONE');
});
test('different session -> pass', async () => {
  const dir = tmp(); await pre(dir, P);
  assert.equal((await pre(dir, P, { session_id: 's2' })).rec.verdict, 'pass');
});
test('same tool_use_id is excluded from priors', async () => {
  const dir = tmp(); await pre(dir, P, { tool_use_id: 'toolu_same' });
  assert.equal((await pre(dir, P, { tool_use_id: 'toolu_same' })).rec.verdict, 'pass');
});

const A = 'Summary: Audit the billing module for dead code\nplease go through every file in the billing module and list dead code with reasons';
const B = 'Summary: Find unused code in billing\nplease go through every file in the billing module and list unused code with reasons';
test('near match + Jev yes -> would_deny semantic; state is only the summaries', async () => {
  const dir = tmp(); await launched(dir, A); const f = fixed(0.95);
  const r = await pre(dir, B, {}, { fetchImpl: f });
  assert.equal(r.rec.verdict, 'would_deny'); assert.equal(r.rec.kind, 'duplicate_semantic'); assert.ok(r.rec.near.score >= 0.5);
  assert.deepEqual(f.last.state, { task_a: 'Audit the billing module for dead code', task_b: 'Find unused code in billing' });
  assert.deepEqual(Object.keys(f.last), ['model', 'state', 'questions']); assert.equal(f.last.model, 'jev-latest');
  assert.ok(!JSON.stringify(f.last).includes('please go through'), 'prompt body must not leave the machine');
  assert.equal(r.rec.jev_p_yes, 0.95);
});
test('near match + Jev no -> pass', async () => {
  const dir = tmp(); await pre(dir, A);
  const r = await pre(dir, B, {}, { fetchImpl: fixed(0.1) }); assert.equal(r.rec.verdict, 'pass'); assert.equal(r.rec.kind, null);
});
test('near match after BLOCKED + yes -> would_flag unless model higher', async () => {
  const dir = tmp(); await finished(dir, A, 'BLOCKED', { model: 'sonnet' });
  assert.equal((await pre(dir, B, { model: 'sonnet' })).rec.kind, 'escalation_refined');
  const dir2 = tmp(); await finished(dir2, A, 'BLOCKED', { model: 'sonnet' });
  assert.equal((await pre(dir2, B, { model: 'opus' })).rec.verdict, 'pass');
});
test('near match missing summary -> no_summary, no fetch', async () => {
  const dir = tmp(); await launched(dir, A); const f = fixed(0.95);
  const r = await pre(dir, B.replace(/^Summary:.*\n/, ''), {}, { fetchImpl: f });
  assert.equal(r.rec.jev_skipped, 'no_summary'); assert.equal(r.rec.verdict, 'pass'); assert.equal(f.calls, 0);
});
test('summary rejected by guard -> skipped, no fetch', async () => {
  const dir = tmp(); await launched(dir, A); const f = fixed(0.95);
  const r = await pre(dir, B.replace('Find unused code in billing', 'Find unused code in src/billing'), {}, { fetchImpl: f });
  assert.equal(r.rec.jev_skipped, 'path_url_email'); assert.ok(!f.last?.questions?.same_task); // router-guard may call the shared fetch
  const r2 = await pre(dir, B.replace('Find unused code in billing', 'x'.repeat(301)), {}, { fetchImpl: f });
  assert.equal(r2.rec.jev_skipped, 'too_long');
});
test('Jev error -> pass with jev_error', async () => {
  const dir = tmp(); await pre(dir, A);
  const r = await pre(dir, B, {}, { fetchImpl: mockFetch(() => new Response('boom', { status: 500 })) });
  assert.equal(r.rec.verdict, 'pass'); assert.equal(r.rec.jev_error, 'http_500');
});
test('Jev throwing generic error -> jev_error "error" or reason, pass', async () => {
  const dir = tmp(); await pre(dir, A);
  const r = await pre(dir, B, {}, { fetchImpl: mockFetch(() => { throw new Error('x'); }) });
  assert.equal(r.rec.verdict, 'pass'); assert.ok(r.rec.jev_error);
});
test('deny mode: exact dup -> deny JSON, not registered', async () => {
  const dir = tmp(); cfg(dir, 'deny'); const first = await launched(dir, P);
  assert.equal(first.output, null);
  const r = await pre(dir, P);
  const out = JSON.parse(r.output).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse'); assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /^Duplicate dispatch: same task as "desc toolu_\d+" \(running, \d\d:\d\d\)\. Use its result, or if a rerun is intended add a line "Rerun: <reason>" to the brief and dispatch again\.$/);
  assert.equal(reg(dir).filter((e) => e.event === 'dispatch').length, 1); assert.equal(log(dir).length, 2);
});
test('deny mode: escalation message', async () => {
  const dir = tmp(); cfg(dir, 'deny'); await finished(dir, P, 'BLOCKED', { model: 'haiku' });
  const out = JSON.parse((await pre(dir, P, { model: 'haiku' })).output).hookSpecificOutput;
  assert.match(out.permissionDecisionReason, /^Repeat of a BLOCKED dispatch \("desc toolu_\d+", \d\d:\d\d\) without a higher model\. /);
});
test('deny mode: would_flag -> additionalContext, dispatch registered', async () => {
  const dir = tmp(); cfg(dir, 'deny'); await finished(dir, A, 'PARTIAL', { model: 'sonnet' });
  const r = await pre(dir, B, { model: 'sonnet' });
  const out = JSON.parse(r.output).hookSpecificOutput;
  assert.deepEqual(Object.keys(out), ['hookEventName', 'additionalContext']); assert.match(out.additionalContext, /^Repeat of a PARTIAL dispatch/);
  assert.equal(reg(dir).filter((e) => e.event === 'dispatch').length, 2);
});
test('log mode prints nothing but registers and logs', async () => {
  const dir = tmp(); await launched(dir, P); const r = await pre(dir, P);
  assert.equal(r.output, null); assert.equal(r.rec.verdict, 'would_deny'); assert.equal(r.rec.mode, 'log');
  assert.equal(reg(dir).length, 3);
});
test('omitted subagent_type still matches exactly', async () => {
  const dir = tmp(); await launched(dir, P, { subagent_type: undefined });
  const r = await pre(dir, P, { subagent_type: undefined });
  assert.equal(r.rec.kind, 'duplicate_exact'); assert.equal(r.rec.verdict, 'would_deny');
});
test('unlaunched running prior never blocks', async () => {
  const dir = tmp(); await pre(dir, P);
  const r = await pre(dir, P);
  assert.equal(r.rec.verdict, 'pass'); assert.equal(r.rec.kind, 'prior_unlaunched');
});
test('null description in deny message', async () => {
  const dir = tmp(); cfg(dir, 'deny');
  const first = await evaluate({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tn1', tool_input: { prompt: P, subagent_type: 'worker' } }, { dir });
  assert.equal(first.output, null); await link(dir, 'tn1', 'an1');
  const r = await evaluate({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tn2', tool_input: { prompt: P, subagent_type: 'worker' } }, { dir });
  assert.match(JSON.parse(r.output).hookSpecificOutput.permissionDecisionReason, /same task as "\(no description\)"/);
});
test('stop status regex variants', async () => {
  for (const [first, want] of [['> DONE', 'DONE'], ['# PARTIAL', 'PARTIAL'], ['DONEX', 'unknown'], ['\n\n  BLOCKED - x', 'BLOCKED']]) {
    const dir = tmp(); await stop(dir, 'z', first); assert.equal(reg(dir)[0].status, want, first);
  }
});
test('summary on line 2 is ignored; corrupt registry prompt does not throw', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'registry.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'dispatch', session_id: 's1', tool_use_id: 'old', prompt: 42, prompt_sha256: 'x' }) + '\n');
  const r = await pre(dir, 'intro line\nSummary: second line');
  assert.equal(r.rec.summary, null); assert.equal(r.rec.verdict, 'pass');
});
test('stop status falls back to the last SubagentHandback in the transcript', async () => {
  const t = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'PARTIAL\nold' } }] } },
    { type: 'assistant', message: { content: [{ type: 'thinking' }, { type: 'tool_use', name: 'SubagentHandback', input: { message: 'BLOCKED\nwhy' } }] } },
  ].map((e) => JSON.stringify(e)).join('\n');
  const dir = tmp();
  await evaluate({ session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'h1', last_assistant_message: '', agent_transcript_path: 'x' }, { dir, transcriptReader: () => ({ text: t }) });
  await evaluate({ session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'h2', agent_transcript_path: 'x' }, { dir, transcriptReader: () => { throw new Error('gone'); } });
  assert.deepEqual(reg(dir).map((e) => e.status), ['BLOCKED', 'unknown']);
});
test('unknown mode behaves as log', async () => {
  const dir = tmp(); cfg(dir, 'banana'); await pre(dir, P); const r = await pre(dir, P);
  assert.equal(r.output, null); assert.equal(r.rec.mode, 'log');
});
test('off mode: no checks, no logs (registry still records for the retry chain)', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'config.json'), JSON.stringify({ dispatchGuard: { mode: 'off' }, retryGuard: { mode: 'off' } }));
  await pre(dir, P); const r = await pre(dir, P);
  assert.equal(r.output, null); assert.equal(log(dir).length, 0); assert.equal(lines(dir, 'retry-guard.jsonl').length, 0);
});
test('registry lines older than 7 days and unparsable lines are ignored', async () => {
  const dir = tmp(); const now = Date.now();
  await pre(dir, P, {}, { now: () => now - 8 * 24 * 3600 * 1000 });
  writeFileSync(join(dir, 'registry.jsonl'), 'garbage{\n' + readFileSync(join(dir, 'registry.jsonl'), 'utf8'), 'utf8');
  const fresh = await pre(dir, P, {}, { now: () => now });
  assert.equal(fresh.rec.verdict, 'pass'); await link(dir, fresh.id, 'aFresh');
  assert.equal((await pre(dir, P, {}, { now: () => now + 1000 })).rec.verdict, 'would_deny'); // the fresh one counts
});
test('garbage and non-Agent input -> no output, no throw, no files', async () => {
  const dir = tmp();
  for (const i of [null, undefined, 42, 'str', [], {}, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
    { hook_event_name: 'PreToolUse', tool_name: 'Agent' }, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 5 } },
    { hook_event_name: 'PostToolUse', tool_name: 'Bash' }, { hook_event_name: 'Stop' }]) {
    const r = await evaluate(i, { dir }); assert.equal(r.output, null);
  }
  assert.equal(reg(dir).length, 0); assert.equal(log(dir).length, 0);
});
test('unwritable dir never throws', async () => {
  const r = await pre(join(tmp(), 'missing', 'sub'), P); assert.equal(r.output, null);
});

// ---- retry guard through the entry point ----
const rcfg = (dir, mode) => writeFileSync(join(dir, 'config.json'), JSON.stringify({ retryGuard: { mode } }));
const rlog = (dir) => lines(dir, 'retry-guard.jsonl');
const BR = 'Run the migration script and report the result of every step carefully';
const preRun = (dir, id, prompt = BR, description = `d ${id}`) =>
  evaluate({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: id, tool_input: { description, prompt, subagent_type: 'worker' } }, { dir });
// foreground order: stop, then link. background order: link, then stop.
const fg = async (dir, id, agent, report) => { await preRun(dir, id); await stop(dir, agent, report); return link(dir, id, agent); };
const bg = async (dir, id, agent, report) => { await preRun(dir, id); await link(dir, id, agent); return stop(dir, agent, report); };
test('retry: foreground and background order each give exactly one verdict', async () => {
  const d1 = tmp(); await fg(d1, 't1', 'a1', 'BLOCKED: tests fail because the fixture is stale');
  const d2 = tmp(); await bg(d2, 't1', 'a1', 'BLOCKED: tests fail because the fixture is stale');
  for (const d of [d1, d2]) { assert.equal(rlog(d).length, 1); assert.equal(rlog(d)[0].class, 'new_cause'); assert.equal(reg(d).filter((e) => e.event === 'retry_verdict').length, 1); }
  assert.deepEqual([rlog(d1)[0].via, rlog(d2)[0].via], ['link', 'stop']);
});
test('retry: DONE gives no verdict', async () => {
  const dir = tmp(); await fg(dir, 't1', 'a1', 'DONE'); assert.equal(rlog(dir).length, 0);
});
test('retry: same signature across attempts -> same_cause_repeat; enforce prints at link', async () => {
  const dir = tmp(); rcfg(dir, 'enforce');
  await fg(dir, 't1', 'a1', 'BLOCKED: build failed with exit code 12 in step 3');
  const out = await fg(dir, 't2', 'a2', 'BLOCKED: build failed with exit code 99 in step 3');
  const v = rlog(dir).at(-1);
  assert.equal(v.class, 'same_cause_repeat'); assert.equal(v.sig_equal, true); assert.equal(v.verdict, 'would_deny'); assert.equal(v.chain_len, 2);
  assert.match(JSON.parse(out.output).hookSpecificOutput.additionalContext, /^Retry check: "d t2" failed again with the same cause as the previous attempt \(\d\d:\d\d\)\./);
});
test('retry: log mode gives null outputs', async () => {
  const dir = tmp();
  await fg(dir, 't1', 'a1', 'BLOCKED: permission denied writing the report');
  const out = await fg(dir, 't2', 'a2', 'BLOCKED: permission denied writing the report');
  assert.equal(out.output, null); assert.equal(rlog(dir).at(-1).class, 'env_auth');
});
test('retry: re-dispatch of a would_deny task -> enforce denies, Rerun overrides, log mode silent', async () => {
  const dir = tmp(); rcfg(dir, 'enforce');
  await fg(dir, 't1', 'a1', 'BLOCKED: permission denied writing the report');
  const h = JSON.parse((await preRun(dir, 't2', BR, 'again')).output).hookSpecificOutput;
  assert.equal(h.permissionDecision, 'deny'); assert.match(h.permissionDecisionReason, /failed on an environment problem \(permission\)/);
  assert.equal(rlog(dir).at(-1).via, 'dispatch');
  const r2 = await preRun(dir, 't3', BR + '\nRerun: env fixed - perms', 'again');
  assert.equal(r2.output, null); assert.equal(rlog(dir).at(-1).verdict, 'rerun_override');
  const d2 = tmp(); await fg(d2, 't1', 'a1', 'BLOCKED: permission denied writing the report');
  assert.equal((await preRun(d2, 't2', BR, 'again')).output, null);
});
test('retry: launch_status error on link is stored (prompt dropped); stop without failure keeps it', async () => {
  const dir = tmp(); await preRun(dir, 't1');
  await evaluate({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_response: { status: 'error', agentId: 'a1', prompt: 'SECRET', message: 'rate limit 429 hit' } }, { dir });
  const l = reg(dir).find((e) => e.event === 'link');
  assert.equal(l.failure.subkind, 'transient'); assert.ok(!JSON.stringify(l).includes('SECRET'));
  await stop(dir, 'a1', 'DONE');
  assert.equal(rlog(dir)[0].class, 'env_auth'); assert.equal(rlog(dir)[0].verdict, 'would_flag');
});
const mk = (broken) => (f) => (f === broken ? Promise.reject(new Error('syntax')) : import(`./${f}`));
test('agent-hooks: broken guard module does not stop the other guard or the recording', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'config.json'), JSON.stringify({ dispatchGuard: { mode: 'deny' }, retryGuard: { mode: 'enforce' } }));
  await fg(dir, 't1', 'a1', 'BLOCKED: permission denied writing the report');
  const ev = (id, loader) => evaluate({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: id, tool_input: { description: 'again', prompt: BR, subagent_type: 'worker' } }, { dir, loader });
  const b = await ev('t3', mk('retry-guard.mjs'));
  assert.match(JSON.parse(b.output).hookSpecificOutput.permissionDecisionReason, /^Repeat of a BLOCKED dispatch/);
  const a = await ev('t2', mk('dispatch-guard.mjs'));
  assert.equal(a.output, null); // no same_as without dispatch-guard: retry-guard stays quiet but nothing throws
  assert.ok(reg(dir).some((e) => e.event === 'dispatch' && e.tool_use_id === 't2'));
  const c = await evaluate({ ...base, hook_event_name: 'SubagentStop', agent_id: 'a9', last_assistant_message: 'BLOCKED: x failed' }, { dir, loader: mk('failure-cause.mjs') });
  assert.equal(c.output, null); assert.equal(reg(dir).at(-1).status, 'BLOCKED');
});
test('agent-hooks: both guards deny -> reasons joined', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'config.json'), JSON.stringify({ dispatchGuard: { mode: 'deny' }, retryGuard: { mode: 'enforce' } }));
  await fg(dir, 't1', 'a1', 'BLOCKED: permission denied writing the report');
  const reason = JSON.parse((await preRun(dir, 't2', BR, 'again')).output).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /Repeat of a BLOCKED dispatch/); assert.match(reason, /Retry check/);
});
test('H2: a denied retry dispatch is not registered, so the next identical dispatch is still denied', async () => {
  const dir = tmp(); rcfg(dir, 'enforce');
  await fg(dir, 't1', 'a1', 'BLOCKED: permission denied writing the report');
  for (const id of ['t2', 't3']) assert.equal(JSON.parse((await preRun(dir, id, BR, 'again')).output).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(reg(dir).filter((e) => e.event === 'dispatch').length, 1);
});
test('M5: launch failure without agent id is judged at the link', async () => {
  const dir = tmp(); await preRun(dir, 't1');
  await evaluate({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_response: { status: 'error', error: 'HTTP 429 rate limit exceeded' } }, { dir });
  const [v] = rlog(dir); assert.deepEqual([rlog(dir).length, v.class, v.subkind, v.via, v.cause_original], [1, 'env_auth', 'transient', 'link', 'HTTP 429 rate limit exceeded']);
});
test('M6: link cause text from error/message/content, else response without ids and prompt', async () => {
  const dir = tmp(); await preRun(dir, 't1'); await preRun(dir, 't2');
  const lk = (id, r) => evaluate({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: id, tool_response: r }, { dir });
  await lk('t1', { status: 'error', content: [{ type: 'text', text: 'connection refused by host' }], agentId: 'x' });
  await lk('t2', { status: 'failed', prompt: 'SECRET', agentId: 'a2', task_id: 'z', detail: 'odd' });
  const [a, b] = reg(dir).filter((e) => e.event === 'link');
  assert.equal(a.failure.cause_original, 'connection refused by host');
  assert.ok(!JSON.stringify(b).includes('SECRET') && !b.failure.cause_original.includes('a2') && b.failure.cause_original.includes('odd'));
});
test('H1: non-empty last_assistant_message without a status line falls back to the handback status', async () => {
  const t = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'BLOCKED\nwhy' } }] } });
  const dir = tmp();
  await evaluate({ session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'h1', last_assistant_message: 'Final summary text', agent_transcript_path: 'x' }, { dir, transcriptReader: () => ({ text: t }) });
  assert.equal(reg(dir)[0].status, 'BLOCKED');
});

const script = join(dirname(fileURLToPath(import.meta.url)), 'agent-hooks.mjs');
const cli = (input, dir) => spawnSync('node', [script], { input, env: { ...process.env, JEV_DIR: dir }, encoding: 'utf8', timeout: 3000 });
test('CLI: garbage stdin exits 0 silently; deny prints JSON', () => {
  const dir = tmp();
  for (const input of ['not json', '', '[]', 'null']) { const r = cli(input, dir); assert.equal(r.status, 0); assert.equal(r.stdout, ''); }
  cfg(dir, 'deny');
  const ev = JSON.stringify({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_cli1', tool_input: { description: 'd', prompt: P, subagent_type: 'worker' } });
  assert.equal(cli(ev, dir).stdout, '');
  cli(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_cli1', tool_response: { agentId: 'acli1' } }), dir);
  const r = cli(ev.replace('toolu_cli1', 'toolu_cli2'), dir);
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('agent-hooks: SubagentStop records the stop and runs retry-guard; report-guard is never loaded', async () => {
  const dir = tmp();
  const loaded = [];
  const stub = (f) => { loaded.push(f); return f === 'retry-guard.mjs' ? Promise.resolve({ afterEvent: async () => { loaded.push('retry-ran'); } }) : import(`./${f}`); };
  const input = { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'r1', last_assistant_message: 'DONE\nAll 3 tests pass.' };
  assert.equal((await evaluate(input, { dir, loader: stub })).output, null);
  assert.ok(loaded.includes('retry-ran')); assert.ok(!loaded.includes('report-guard.mjs'), loaded.join(','));
  assert.deepEqual([reg(dir).at(-1).agent_id, reg(dir).at(-1).status], ['r1', 'DONE']);
});
test('UserPromptSubmit: first prompt fires through the loader, second does not; other entrypoint skips', async () => {
  const dir = tmp();
  const input = { session_id: 'up1', hook_event_name: 'UserPromptSubmit', prompt: 'hello' };
  const cliEnv = { CLAUDE_CODE_ENTRYPOINT: 'cli' };
  const h = JSON.parse((await evaluate(input, { dir, env: cliEnv })).output).hookSpecificOutput;
  assert.equal(h.hookEventName, 'UserPromptSubmit');
  assert.ok(h.additionalContext.includes('main-pick.mjs'));
  assert.equal((await evaluate(input, { dir, env: cliEnv })).output, null);
  assert.equal((await evaluate({ ...input, session_id: 'up2' }, { dir, env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } })).output, null);
});
test('UserPromptSubmit: broken trigger module -> null (fail-open)', async () => {
  const r = await evaluate({ session_id: 'up3', hook_event_name: 'UserPromptSubmit' }, { dir: tmp(), loader: () => { throw new Error('x'); } });
  assert.equal(r.output, null);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
