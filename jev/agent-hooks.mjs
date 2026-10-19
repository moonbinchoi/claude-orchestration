// agent-hooks: hook entry for PreToolUse(Agent), PostToolUse(Agent) and SubagentStop. Records events in the registry and
// runs dispatch-guard, retry-guard and report-guard. Each guard loads in its own try/catch so one broken module never stops the other
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
const HOOK_BUDGET_MS = 3800; // the entry self-exits at 4 s

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
  return ctx.length ? { hookSpecificOutput: { hookEventName: hs[0].hookEventName, additionalContext: ctx.join('\n') } } : null;
}

export async function evaluate(input, { fetchImpl = fetch, dir = defaultDir(), now = Date.now, startedAt = now(), transcriptReader = readTail, loader = (f) => import(`./${f}`) } = {}) {
  if (!input || typeof input !== 'object') return { output: null };
  const ev = input.hook_event_name;
  const sid = input.session_id ?? null;
  const ts = () => new Date(now()).toISOString();
  const out = (o) => ({ output: o ? JSON.stringify(o) : null });

  if (ev === 'PreToolUse' && input.tool_name === 'Agent') {
    if (typeof input.tool_input?.prompt !== 'string') return { output: null };
    const priors = readRegistry(dir, now(), sid).filter((d) => d.tool_use_id !== (input.tool_use_id ?? null));
    const dg = await attempt(async () => (await loader('dispatch-guard.mjs')).onDispatch(input, { priors, fetchImpl, dir, now }));
    const rg = await attempt(async () => (await loader('retry-guard.mjs')).onDispatch(input, { priors, sameAs: dg?.record?.same_as ?? null, dir, now }));
    const merged = merge([dg?.output, rg]);
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

  if (ev === 'SubagentStop') {
    const tr = await attempt(() => transcriptReader(input.agent_transcript_path)); // read once, shared by the report reader and report-guard
    const { text, status } = readReport(input, () => tr?.text ?? '');
    const fc = await attempt(() => loader('failure-cause.mjs'));
    const failure = (await attempt(() => fc?.classifyFailure({ text, status, launchStatus: null }))) ?? null;
    append(dir, 'registry.jsonl', { ts: ts(), event: 'stop', session_id: sid, agent_id: input.agent_id ?? null, status, failure });
    await Promise.all([
      attempt(async () => (await loader('retry-guard.mjs')).afterEvent(input, { dir, now, fetchImpl, via: 'stop' })),
      attempt(async () => {
        const guardModule = await loader('report-guard.mjs');
        return guardModule.onStop(input, { text, status, transcript: tr, deadlineAt: startedAt + HOOK_BUDGET_MS, dir, now, fetchImpl });
      }),
    ]);
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
      const { output } = await evaluate(input, { dir: process.env.JEV_DIR || defaultDir(), startedAt: Date.now() - process.uptime() * 1000 });
      if (output) process.stdout.write(output);
    }
  } catch { /* fail-open */ }
  process.exitCode = 0;
}
