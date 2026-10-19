// report-check: check one subagent report against its transcript and return the log record. Does not write or read config.
import { assertEnglish } from './jev-client.mjs';
import { extractClaims } from './report-claims.mjs';
import { parseTranscript } from './transcript-evidence.mjs';
import { applyRules } from './claim-rules.mjs';
import { judgePairs, DEADLINE_MS } from './claim-judge.mjs';

const MAX_PAIRS = 3;
const RANK = { none: 0, cannot_tell: 1, minor: 2, serious: 3 };

// input: SubagentStop-like { session_id, agent_id, agent_type }; transcript: { text, bytes, truncated } already read (null: unreadable);
// noJev logs pairs as jev_skipped; deadlineMs caps the Jev call; deadlineAt (ms timestamp) caps it by the time left when the call starts, after transcript parsing.
export async function checkReport(input, { text, status, transcript, alias, now = Date.now, fetchImpl = fetch, random = Math.random, noJev = false, deadlineMs, deadlineAt } = {}) {
  const rec = {
    ts: new Date(now()).toISOString(), session_id: input?.session_id ?? null, agent_id: input?.agent_id ?? null, agent_type: input?.agent_type ?? null,
    status, skipped: null, transcript_bytes: null, truncated: false, claims: [], jev: [], verdict: 'none', unextracted_sample: [],
  };
  const skip = (why) => { rec.skipped = why; return rec; };
  if (status !== 'DONE' && status !== 'PARTIAL') return skip('status');
  const t = transcript;
  if (!t) return skip('no_transcript');
  rec.transcript_bytes = t.bytes;
  rec.truncated = t.truncated;
  const { brief, calls } = parseTranscript(t.text, { truncated: t.truncated });
  if (brief && /^Verifies:\s*\S+/m.test(brief)) return skip('verifies');
  try { assertEnglish(text); } catch { return skip('not_checked'); }

  const { claims, sample } = extractClaims(text, { random, agentType: input?.agent_type });
  rec.unextracted_sample = sample;
  const { results, doneError } = applyRules(claims, calls, { status, report: text, truncated: t.truncated, agentType: input?.agent_type });
  const entries = claims.map((c, i) => ({ type: c.type, original: c.original, ...results[i] }));
  if (doneError) entries.push({ type: 'done_status', original: doneError.pair.claim.slice(0, 300), ...doneError });

  const pending = entries.filter((e) => e.verdict === 'jev');
  const toSend = pending.slice(0, MAX_PAIRS);
  for (const e of pending.slice(MAX_PAIRS)) Object.assign(e, { verdict: 'cannot_tell', rule: `${e.rule}; pair_cap` });
  const judged = noJev ? toSend.map(() => ({ claim_sent: null, evidence_sent: null, verdict: 'cannot_tell', jev_skipped: true })) : await judgePairs(toSend.map((e) => e.pair), { fetchImpl, alias, now, deadlineMs: deadlineAt != null ? Math.max(0, Math.min(DEADLINE_MS, deadlineAt - now())) : deadlineMs });
  toSend.forEach((e, i) => { e.verdict = judged[i].verdict; });
  rec.jev = judged;
  rec.claims = entries.map(({ type, original, verdict, rule, evidence }) => ({ type, original, verdict, rule, evidence }));
  rec.verdict = rec.claims.reduce((w, c) => (RANK[c.verdict] > RANK[w] ? c.verdict : w), 'none');
  return rec;
}
