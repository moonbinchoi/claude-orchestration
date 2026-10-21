// shadow-run: Jev's opinion next to the local verdicts, never instead of them. All claim pairs run in parallel under one window.
// Order of the call budget: the existing Jev pairs (`used`), then claim pairs in claim order.
import { judgePairs } from './claim-judge.mjs';
import { shadowPair } from './shadow-pair.mjs';

export const MAX_CALLS = 8;

// items: [{ claim, result }] for claims the local rules judged. Returns { shadows: one jev_shadow per item }.
export async function runShadow({ items, used, fetchImpl, alias, now, deadlineMs, capped }) {
  const sent = items.slice(0, Math.max(0, MAX_CALLS - used));
  const judged = await judgePairs(sent.map((it) => shadowPair(it.claim, it.result)), { fetchImpl, alias, now, deadlineMs });
  const shadows = items.map((_, i) => {
    if (i >= sent.length) return { verdict: 'cannot_tell', p: null, confidence: null, latency_ms: null, jev_error: null, reason: 'budget_cap', jev_skipped: null };
    const r = judged[i];
    const { verdict, p, confidence, latency_ms, reason, jev_skipped } = r;
    return { verdict, p, confidence, latency_ms, jev_error: capped && r.jev_error === 'timeout' ? 'deadline' : r.jev_error, reason, jev_skipped };
  });
  return { shadows };
}
