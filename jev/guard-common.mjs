// guard-common: small helpers shared by dispatch-guard, retry-guard, failure-cause and the hook entry.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const RERUN = /^Rerun:\s*\S/im;
// slash path, url, email or backslash path left in text that would go to Jev
export const PATH_URL_EMAIL = /\w\/\w|:\/\/|@\w+\.|\w\\\w/;

export const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

// config.json[key].mode when it is one of `modes`, else 'log'; plus the Jev model alias.
export function loadConfig(dir, key, modes) {
  const c = readJson(join(dir, 'config.json'));
  const mode = c?.[key]?.mode;
  return {
    mode: modes.includes(mode) ? mode : 'log',
    alias: typeof c?.modelAlias === 'string' && c.modelAlias ? c.modelAlias : 'jev-latest',
  };
}

export const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export const normalize = (p) => p.trim().replace(/\s+/g, ' ').toLowerCase();
export const tokens = (p) => new Set(String(p).match(/[\p{L}\p{N}]+/gu) ?? []);
export function jaccard(A, B) {
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// The registry dispatch event for one Agent call; the single builder used by dispatch-guard and the entry's fallback.
export function dispatchEvent(input, ts, sameAs = null) {
  const ti = input.tool_input;
  const norm = normalize(ti.prompt);
  const firstLine = ti.prompt.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return {
    ts, event: 'dispatch', session_id: input.session_id ?? null, tool_use_id: input.tool_use_id ?? null, subagent_type: ti.subagent_type ?? null,
    model: ti.model ?? null, effort: ti.effort ?? null, description: ti.description ?? null, summary: firstLine.match(/^Summary:\s*(.+)$/i)?.[1] ?? null,
    prompt_sha256: createHash('sha256').update(norm).digest('hex'), prompt: norm, same_as: sameAs,
  };
}
