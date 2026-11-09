// breaker: circuit-breaker state shared by jev-tier and main-pick (state file, default breaker.json: failures, open_until).
// open = state at creation; ok()/fail() record a call result; save() writes only when a call was made.
// Thresholds not passed come from config.json (breakerFailures, breakerOpenMs), so every caller trips alike.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './guard-common.mjs';

export function createBreaker({ dir, now = Date.now, failures, openMs, file = 'breaker.json' }) {
  const c = readJson(join(dir, 'config.json'));
  failures ??= Number.isFinite(c?.breakerFailures) ? c.breakerFailures : 3;
  openMs ??= Number.isFinite(c?.breakerOpenMs) ? c.breakerOpenMs : 30000;
  const path = join(dir, file);
  const s = readJson(path) ?? {}; // missing or corrupt: closed
  const st = { failures: Number.isFinite(s.failures) ? s.failures : 0, open_until: Number.isFinite(s.open_until) ? s.open_until : 0 };
  const open = st.open_until > now();
  let dirty = false;
  return {
    open,
    ok() { dirty = true; st.failures = 0; st.open_until = 0; },
    fail() { dirty = true; st.failures++; if (st.failures >= failures) st.open_until = now() + openMs; },
    save() { if (!dirty) return; try { writeFileSync(path, JSON.stringify(st)); } catch { /* state IO never breaks the run */ } },
  };
}
