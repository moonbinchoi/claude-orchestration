// shadow-run: Jev's opinion next to the local verdicts, never instead of them. All calls run in parallel under one window.
// Order of the call budget: the existing Jev pairs (`used`), then the report-level question, then claim pairs in claim order.
import { judgePairs } from './claim-judge.mjs';
import { judgeReport } from './report-judge.mjs';
import { assertiveSentences } from './report-sentences.mjs';
import { shadowPair } from './shadow-pair.mjs';

export const MAX_CALLS = 8;

// items: [{ claim, result }] for claims the local rules judged. Returns { jev_report, shadows: one jev_shadow per item }.
export async function runShadow({ text, brief, items, used, fetchImpl, alias, now, deadlineMs, capped }) {
  const opts = { fetchImpl, alias, now, deadlineMs };
  const sel = assertiveSentences(text);
  const room = Math.max(0, MAX_CALLS - used - (sel.sentences.length ? 1 : 0));
  const sent = items.slice(0, room);
  const [report, judged] = await Promise.all([judgeReport(sel, brief, opts), judgePairs(sent.map((it) => shadowPair(it.claim, it.result)), opts)]);
  const fix = (r) => (capped && r.jev_error === 'timeout' ? { ...r, jev_error: 'deadline' } : r);
  const shadows = items.map((_, i) => {
    if (i >= sent.length) return { verdict: 'cannot_tell', p: null, confidence: null, latency_ms: null, jev_error: null, reason: 'budget_cap' };
    const { verdict, p, confidence, latency_ms, jev_error, reason } = fix(judged[i]);
    return { verdict, p, confidence, latency_ms, jev_error, reason };
  });
  return { jev_report: fix(report), shadows };
}
