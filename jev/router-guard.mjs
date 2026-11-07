// router-guard: PreToolUse(Agent) tier router. Lowers tool_input.model through updatedInput when Jev picks a cheaper tier than the rule tier.
// router.mode in config.json: 'apply' (default) | 'log' (compute and log only) | 'off'. Fail-open; never logs the prompt.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run, FLOOR, EFFORTS } from './jev-tier.mjs';
import { append } from './registry.mjs';
import { readJson } from './guard-common.mjs';

const TIERS = ['haiku', 'sonnet', 'opus'];
// shares the 3.8 s hook budget with dispatch-guard's Jev call (2 s)
const DEADLINE_MS = 1000;
// word stems so plurals and other forms match ("secrets", "migrations", "deleting"); "auth" alone or auth(entic|oriz)*, not "authored"
// the lock names the model to dispatch; anything else after "Model-lock:" is denied
const LOCK = /^Model-lock:[ \t]*(haiku|sonnet|opus|fable)(?=\s|$)/i;
const LOCK_DENY = 'Model-lock must name a model: "Model-lock: <haiku|sonnet|opus|fable>". Add the model and dispatch again.';
const SENSITIVE =/\b(secur\w*|secret\w*|credential\w*|auth|oauth\w*|authenticat\w*|authoriz\w*|permission\w*|deploy\w*|migrat\w*|delet\w*|drop\w*|wip(e|es|ed|ing)|purg\w*|token\w*|password\w*|data loss|production|prod)\b/i;

// model and effort: from the frontmatter block only; undefined = no such file, null field = file without that line
const agentModel = (agentsDir, name) => {
  let text;
  try { text = readFileSync(join(agentsDir, `${name}.md`), 'utf8'); } catch { return undefined; }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const field = (k) => fm.match(new RegExp(`^${k}:\\s*(\\S+)`, 'm'))?.[1]?.toLowerCase() ?? null;
  return { model: field('model'), effort: field('effort') };
};
// a project agent overrides the user agent of the same name; walk up from cwd, which can be a project subfolder
const projectModel = (dir, name) => {
  const found = agentModel(join(dir, '.claude', 'agents'), name);
  const up = dirname(dir);
  return found !== undefined || up === dir ? found : projectModel(up, name);
};
const ruleTierOf = (name, cwd, agentsDir) => {
  const project = typeof cwd === 'string' ? projectModel(resolve(cwd), name) : undefined;
  return (project !== undefined ? project : agentModel(agentsDir, name)) ?? { model: null, effort: null };
};

export async function onDispatch(input, { fetchImpl = fetch, dir, now = Date.now, agentsDir = join(homedir(), '.claude', 'agents') } = {}) {
  const ti = input?.tool_input;
  if (!ti || typeof ti.prompt !== 'string') return null;
  const mode = ['apply', 'log', 'off'].find((m) => m === readJson(join(dir, 'config.json'))?.router?.mode) ?? 'apply';
  if (mode === 'off') return null;
  const start = now();
  const type = ti.subagent_type ?? null;
  const rec = { ts: new Date(start).toISOString(), session_id: input.session_id ?? null, tool_use_id: input.tool_use_id ?? null, cwd: input.cwd ?? null, subagent_type: type, rule_model: null, jev_model: null, applied_model: null, lock_model: null, rule_effort: null, jev_effort: null, effort_would_apply: null, skip: null, latency_ms: null };
  const finish = (output = null) => { rec.latency_ms = now() - start; append(dir, 'router.jsonl', rec); return output; };
  const decide = (permissionDecision, extra) => (mode === 'log' ? null : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, ...extra } });

  const m = typeof ti.model === 'string' ? ti.model.toLowerCase() : null;
  const agent = type ? ruleTierOf(type, input.cwd, agentsDir) : { model: null, effort: null };
  const rule = m ?? agent.model;
  rec.rule_model = rule;
  // a fork ignores the model it is given, so a lock on it means nothing
  if (type === 'fork') { rec.skip = 'fork'; return finish(); }
  const lockLine = ti.prompt.split(/\r?\n/).find((l) => /^Model-lock:/i.test(l));
  if (lockLine !== undefined) {
    rec.lock_model = lockLine.match(LOCK)?.[1]?.toLowerCase() ?? null;
    if (!rec.lock_model) { rec.skip = 'model_lock_invalid'; return finish(decide('deny', { permissionDecisionReason: LOCK_DENY })); }
    rec.skip = 'model_lock';
    if (mode === 'log') return finish();
    rec.applied_model = rec.lock_model;
    return finish(decide('allow', { updatedInput: { ...ti, model: rec.lock_model } }));
  }
  const summary = ti.prompt.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).map((l) => l.match(/^Summary:\s*(.+)$/i)?.[1]).find(Boolean);
  if (!summary) { rec.skip = 'no_summary'; return finish(); }
  if (m === 'fable') { rec.skip = 'fable'; return finish(); }
  // shadow: Jev is still called and logged so every dispatch has evaluation data, but its answer is never applied
  if (SENSITIVE.test(summary)) { rec.skip = 'sensitive'; return finish(); }
  let shadow = null;
  if (!TIERS.includes(rule)) shadow = 'rule_unknown';
  // nothing to lower: the rule tier is already the lowest tier Jev's answer can end at (haiku, or the agent's floor)
  else if (TIERS.indexOf(rule) <= TIERS.indexOf(FLOOR[type] ?? 'haiku')) shadow = 'at_floor';

  const [r] = await run({ tasks: [{ id: input.tool_use_id ?? null, summary, agent_type: type, rule_model: rule }] }, { fetchImpl, dir, now, deadlineMs: DEADLINE_MS });
  rec.jev_model = r?.model ?? null;
  // effort shadow: logged only, never applied; no effort without a model verdict or with an unknown rule tier
  if (rec.jev_model && shadow !== 'rule_unknown') {
    rec.rule_effort = (typeof ti.effort === 'string' ? ti.effort : agent.effort)?.toLowerCase() ?? null;
    rec.jev_effort = r.effort ?? null;
    const [ri, ji] = [EFFORTS.indexOf(rec.rule_effort), EFFORTS.indexOf(rec.jev_effort)];
    if (ri >= 0 && ji >= 0 && ji < ri) rec.effort_would_apply = rec.jev_effort;
  }
  if (shadow) rec.skip = shadow;
  else if (!rec.jev_model) rec.skip = `jev: ${r?.fallback_reason ?? 'error'}`;
  else if (TIERS.indexOf(rec.jev_model) >= TIERS.indexOf(rule)) rec.skip = 'not_lower';
  else if (mode === 'log') rec.skip = 'log_mode';
  else {
    rec.applied_model = rec.jev_model;
    return finish({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...ti, model: rec.jev_model } } });
  }
  return finish();
}
