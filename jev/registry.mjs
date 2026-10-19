// registry: append events to a jsonl file and fold one session's events into dispatches. No decisions here.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEEK_MS = 7 * 24 * 3600 * 1000;

// ponytail: registry.jsonl is never truncated (reads skip lines older than 7 days); rotate by size if it grows
export function append(dir, file, obj) {
  try { appendFileSync(join(dir, file), JSON.stringify(obj) + '\n'); } catch { /* log IO never breaks the run */ }
}

// Fold one session's events into dispatches[]. Order-independent for link/stop/verdict: they are applied after all dispatches are known.
// SubagentStop carries the parent session_id (verified 2026-10-19).
export function readRegistry(dir, nowMs, sid) {
  let text = '';
  try { text = readFileSync(join(dir, 'registry.jsonl'), 'utf8'); } catch { return []; }
  const key = `"session_id":${JSON.stringify(sid)}`; // cheap prefilter before JSON.parse
  const list = [];
  const rest = [];
  for (const l of text.split('\n')) {
    if (!l.includes(key)) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (!e || typeof e !== 'object' || e.session_id !== sid || !(nowMs - Date.parse(e.ts) <= WEEK_MS)) continue;
    if (e.event === 'dispatch') list.push({ ...e, status: 'running', agent_id: null, resolved_model: null, launch_status: null, failure: null, verdict: null, same_as: e.same_as ?? null });
    else rest.push(e);
  }
  let linkFailure = new Map();
  for (const e of rest) {
    if (e.event !== 'link') continue;
    const d = list.find((x) => x.tool_use_id === e.tool_use_id);
    if (!d) continue;
    Object.assign(d, { agent_id: e.agent_id, resolved_model: e.resolved_model, launch_status: e.launch_status ?? null });
    if (e.failure) linkFailure.set(d, e.failure);
  }
  for (const e of rest) {
    if (e.event === 'stop') {
      const d = list.find((x) => x.agent_id && x.agent_id === e.agent_id);
      if (d) { d.status = e.status; if (e.failure) d.failure = e.failure; }
    } else if (e.event === 'retry_verdict') {
      const d = list.find((x) => x.tool_use_id === e.tool_use_id);
      if (d) d.verdict = { class: e.class, subkind: e.subkind ?? null, verdict: e.verdict, chain_len: e.chain_len ?? 1 };
    }
  }
  for (const [d, f] of linkFailure) d.failure ??= f;
  return list;
}
