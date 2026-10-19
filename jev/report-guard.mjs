// report-guard: at SubagentStop, check the subagent report's claims against its transcript and log the verdict.
// Log-only: returns nothing to the hook. Fail-open (the entry wraps this in attempt).
import { append } from './registry.mjs';
import { loadConfig } from './guard-common.mjs';
import { checkReport } from './report-check.mjs';

export async function onStop(input, { text = '', status = 'unknown', transcript = null, deadlineAt, deadlineMs, dir, now = Date.now, fetchImpl = fetch, random = Math.random } = {}) {
  // ponytail: 'enforce' acts like 'log' for now; the main-facing output (reviewer dispatch, notices) is built at promotion
  const { mode, alias } = loadConfig(dir, 'reportGuard', ['log', 'enforce', 'off']);
  if (mode === 'off' || !input) return;
  const rec = await checkReport(input, { text, status, transcript, alias, now, fetchImpl, random, deadlineAt, deadlineMs });
  append(dir, 'report-guard.jsonl', { ...rec, mode });
}
