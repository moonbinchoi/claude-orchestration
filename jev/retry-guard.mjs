// retry-guard: decide whether a failed subagent task failed for the same cause as its previous attempt (local signature only), and flag the retry.
// Log-only unless retryGuard.mode is 'notice' (flagged verdicts become additionalContext, never deny) or 'enforce'. Fail-open.
import { compareCauses } from './failure-cause.mjs';
import { append, readRegistry } from './registry.mjs';
import { RERUN, hhmm, loadConfig } from './guard-common.mjs';

const NEAR_MIN = 0.5;
const ENV = new Set(['auth', 'permission', 'network', 'missing_tool']);

function message(cls, subkind, desc, ts) {
  const d = desc ?? '(no description)';
  if (cls === 'same_cause_repeat') return `Retry check: "${d}" failed again with the same cause as the previous attempt (${hhmm(ts)}). Repeating it will not help: change the approach, settle the open decision, or ask the user. To rerun anyway add a line "Rerun: <reason>".`;
  if (subkind === 'transient') return 'Retry check: "' + d + '" failed on a transient error (rate limit, overload or reset). Wait, then retry with the same brief.';
  return `Retry check: "${d}" failed on an environment problem (${subkind}). Fix the environment first (tell the user if it needs their action), then dispatch again with a line "Rerun: env fixed - <what>".`;
}

const flagged = (v) => v === 'would_deny' || v === 'would_flag';
const MODES = ['enforce', 'notice', 'off'];
const speaks = (mode) => mode === 'enforce' || mode === 'notice';

// dispatch: folded dispatch with failure; prior: folded same_as dispatch or null. Returns a verdict record, or null when not failed.
export async function judge(dispatch, prior, { now = Date.now } = {}) {
  const f = dispatch?.failure;
  if (!f) return null;
  const start = now();
  const pf = prior?.failure ?? null;
  const rec = {
    ts: new Date(start).toISOString(), session_id: dispatch.session_id ?? null, tool_use_id: dispatch.tool_use_id ?? null, agent_id: dispatch.agent_id ?? null,
    prior_tool_use_id: prior?.tool_use_id ?? null, chain_len: pf ? (prior.verdict?.chain_len ?? 1) + 1 : 1, class: null, subkind: f.subkind ?? null,
    sig_equal: null, jaccard: null, jev_skipped: null,
    cause_original: f.cause_original ?? null, mode: null, via: null, verdict: 'pass',
  };
  const done = (cls, verdict) => { rec.class = cls; rec.verdict = verdict; return rec; };
  if (ENV.has(f.subkind)) return done('env_auth', 'would_deny');
  if (f.subkind === 'transient') return done('env_auth', 'would_flag');
  if (!pf) return done('new_cause', 'pass');
  if (!f.cause_sig || !pf.cause_sig) { rec.jev_skipped = (!f.cause_sig ? f : pf).skip_reason ?? 'no_cause'; return done('unknown', 'pass'); }
  const { sig_equal, jaccard } = compareCauses(pf, f);
  Object.assign(rec, { sig_equal, jaccard });
  if (sig_equal) return done('same_cause_repeat', 'would_deny');
  if (jaccard < NEAR_MIN) return done('new_cause', 'pass');
  return done('unknown', 'pass'); // near pair, different signature: undecided without a classifier
}

// ponytail: concurrent stop/link hooks can both read "no verdict" and write two verdicts (the fold keeps the last), or each see the
// other's event missing and write none; fail-open, add a lock or an atomic marker if it matters.
// Call after the entry appended the link or stop event. Judges once, when the dispatch has both link and stop and no verdict.
export async function afterEvent(input, { dir, now = Date.now, via } = {}) {
  const { mode } = loadConfig(dir, 'retryGuard', MODES);
  if (mode === 'off' || !input) return null;
  const list = readRegistry(dir, now(), input.session_id ?? null);
  const id = via === 'stop' ? input.agent_id : input.tool_use_id;
  if (!id) return null;
  const d = list.find((x) => (via === 'stop' ? x.agent_id : x.tool_use_id) === id);
  if (!d || !d.failure || d.verdict) return null;
  // a launch failure has no agent and so no stop: judge at the link; otherwise wait for both link and stop
  if (d.agent_id ? d.status === 'running' : via !== 'link') return null;
  const prior = d.same_as ? list.find((x) => x.tool_use_id === d.same_as) ?? null : null;
  const rec = await judge(d, prior, { now });
  if (!rec) return null;
  Object.assign(rec, { mode, via });
  append(dir, 'retry-guard.jsonl', rec);
  append(dir, 'registry.jsonl', { ts: rec.ts, event: 'retry_verdict', session_id: rec.session_id, tool_use_id: rec.tool_use_id, class: rec.class, subkind: rec.subkind, verdict: rec.verdict, chain_len: rec.chain_len });
  if (!speaks(mode) || via !== 'link' || !flagged(rec.verdict)) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message(rec.class, rec.subkind, d.description, prior?.ts ?? d.ts) } };
}

// A new dispatch that the dispatch guard matched (sameAs) to a prior with a flagged verdict. No Jev call.
export function onDispatch(input, { priors = [], sameAs = null, dir, now = Date.now } = {}) {
  const { mode } = loadConfig(dir, 'retryGuard', MODES);
  if (mode === 'off' || !sameAs) return null;
  const prior = priors.find((p) => p.tool_use_id === sameAs);
  const v = prior?.verdict;
  if (!v || !flagged(v.verdict)) return null;
  const rerun = RERUN.test(input?.tool_input?.prompt ?? '');
  append(dir, 'retry-guard.jsonl', {
    ts: new Date(now()).toISOString(), session_id: input?.session_id ?? null, tool_use_id: input?.tool_use_id ?? null, prior_tool_use_id: sameAs,
    class: v.class, subkind: v.subkind, mode, via: 'dispatch', verdict: rerun ? 'rerun_override' : v.verdict,
  });
  if (rerun || !speaks(mode)) return null;
  const text = message(v.class, v.subkind, prior.description, prior.ts);
  return mode === 'enforce' && v.verdict === 'would_deny'
    ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text } }
    : { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } };
}
