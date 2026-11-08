// agent-hooks: hook entry for PreToolUse(Agent), PostToolUse(Agent), SubagentStop and UserPromptSubmit. Records events in the registry and
// runs router-guard (model downgrade), dispatch-guard and retry-guard; UserPromptSubmit runs stale-resume (blocks a resume that would rewrite an expired cache), then main-pick-trigger (first-prompt model hint). Each guard loads in its own try/catch so one broken module never stops the other
// or the recording. Fail-open, always exit 0.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { append, readRegistry } from './registry.mjs';
import { readReport } from './subagent-report.mjs';
import { readTail } from './transcript-read.mjs';
import { dispatchEvent, textOf } from './guard-common.mjs';

const defaultDir = () => join(homedir(), '.claude', 'jev');
const LAUNCH_FAILED = /error|fail/i;
const CAUSE_MAX = 300;

const attempt = async (fn) => { try { return await fn(); } catch { return null; } };

// cause text of a failed launch: error/message/content text, else the response without prompt and id-like fields
function launchText(r) {
  const content = Array.isArray(r.content) ? textOf(r.content, ' ') : r.content;
  const first = [r.error, r.message, content].find((v) => typeof v === 'string' && v.trim());
  if (first) return first;
  return JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'prompt' && !/id$/i.test(k))));
}

function merge(outs) {
  const hs = outs.filter(Boolean).map((o) => o.hookSpecificOutput);
  if (!hs.length) return null;
  const denies = hs.filter((h) => h.permissionDecision === 'deny');
  if (denies.length) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: denies.map((h) => h.permissionDecisionReason).join(' ') } };
  const ctx = hs.map((h) => h.additionalContext).filter(Boolean);
  const upd = hs.find((h) => h.updatedInput);
  if (!ctx.length && !upd) return null;
  return { hookSpecificOutput: { hookEventName: hs[0].hookEventName, ...(upd && { permissionDecision: 'allow', updatedInput: upd.updatedInput }), ...(ctx.length && { additionalContext: ctx.join('\n') }) } };
}

export async function evaluate(input, { fetchImpl = fetch, dir = defaultDir(), now = Date.now, transcriptReader = readTail, loader = (f) => import(`./${f}`), env = process.env } = {}) {
  if (!input || typeof input !== 'object') return { output: null };
  const ev = input.hook_event_name;
  const sid = input.session_id ?? null;
  const ts = () => new Date(now()).toISOString();
  const out = (o) => ({ output: o ? JSON.stringify(o) : null });

  if (ev === 'PreToolUse' && input.tool_name === 'Agent') {
    if (typeof input.tool_input?.prompt !== 'string') return { output: null };
    const ro = await attempt(async () => (await loader('router-guard.mjs')).onDispatch(input, { fetchImpl, dir, now }));
    const updated = ro?.hookSpecificOutput?.updatedInput;
    if (updated) input = { ...input, tool_input: updated }; // guards and the registry see the model actually dispatched
    const priors = readRegistry(dir, now(), sid).filter((d) => d.tool_use_id !== (input.tool_use_id ?? null));
    const dg = await attempt(async () => (await loader('dispatch-guard.mjs')).onDispatch(input, { priors, fetchImpl, dir, now }));
    const rg = await attempt(async () => (await loader('retry-guard.mjs')).onDispatch(input, { priors, sameAs: dg?.record?.same_as ?? null, dir, now }));
    const merged = merge([ro, dg?.output, rg]);
    // a denied dispatch is not registered; the fallback event (dispatch-guard broken) comes from the same builder
    if (merged?.hookSpecificOutput.permissionDecision !== 'deny') append(dir, 'registry.jsonl', dg?.event ?? dispatchEvent(input, ts()));
    return out(merged);
  }

  if (ev === 'PostToolUse' && input.tool_name === 'Agent') {
    const r = input.tool_response ?? {};
    const event = { ts: ts(), event: 'link', session_id: sid, tool_use_id: input.tool_use_id ?? null, agent_id: r.agentId ?? null, resolved_model: r.resolvedModel ?? null, launch_status: r.status ?? null };
    if (typeof r.status === 'string' && LAUNCH_FAILED.test(r.status)) {
      const fc = await attempt(() => loader('failure-cause.mjs'));
      const failure = fc?.classifyFailure({ text: launchText(r).slice(0, CAUSE_MAX), status: null, launchStatus: r.status });
      if (failure) event.failure = failure;
    }
    append(dir, 'registry.jsonl', event);
    return out(await attempt(async () => (await loader('retry-guard.mjs')).afterEvent(input, { dir, now, fetchImpl, via: 'link' })));
  }

  if (ev === 'UserPromptSubmit') {
    const stale = await attempt(async () => (await loader('stale-resume.mjs')).onPrompt(input, { dir, env, now }));
    if (stale) return out(stale);
    return out(await attempt(async () => (await loader('main-pick-trigger.mjs')).onPrompt(input, { dir, env, now })));
  }

  if (ev === 'SubagentStop') {
    const tr = await attempt(() => transcriptReader(input.agent_transcript_path));
    const { text, status } = readReport(input, () => tr?.text ?? '');
    const fc = await attempt(() => loader('failure-cause.mjs'));
    const failure = (await attempt(() => fc?.classifyFailure({ text, status, launchStatus: null }))) ?? null;
    append(dir, 'registry.jsonl', { ts: ts(), event: 'stop', session_id: sid, agent_id: input.agent_id ?? null, status, failure });
    await attempt(async () => (await loader('retry-guard.mjs')).afterEvent(input, { dir, now, fetchImpl, via: 'stop' }));
    return { output: null };
  }
  return { output: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setTimeout(() => process.exit(0), 4000).unref(); // margin under the 5 s hook timeout for cold starts
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    let input = null;
    try { input = JSON.parse(raw); } catch { /* garbage stdin: silent exit */ }
    if (input && typeof input === 'object') {
      const { output } = await evaluate(input, { dir: process.env.JEV_DIR || defaultDir() });
      if (output) process.stdout.write(output);
    }
  } catch { /* fail-open */ }
  process.exitCode = 0;
}
