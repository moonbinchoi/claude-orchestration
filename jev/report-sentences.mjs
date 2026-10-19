// report-sentences: pick up to 5 assertive English sentences of a report that may be sent to Jev. No IO.
// Same quote and citation stripping as the claim extractor; a sentence that fails the outbound checks is dropped and counted.
import { STATUS } from './guard-common.mjs';
import { isCitedLine, unquote, CITE } from './report-claims.mjs';
import { outbound } from './outbound.mjs';

const ASSERTIVE = /\b(?:all|every|each|verified|confirmed|checked|not found|no|never|none|not stated|passes|passed|complete|completed|fully|always|only)\b/i;
const BULLET = /^([-*]|\d+[.)]|#+)\s+/;
const MAX = 5;

// Returns { sentences: [redacted text], dropped: n }.
export function assertiveSentences(report) {
  const sentences = [];
  let dropped = 0;
  let fence = false;
  let first = true;
  for (const raw of String(report).split('\n')) {
    if (raw.trim().startsWith('```')) { fence = !fence; continue; }
    if (fence || isCitedLine(raw)) continue;
    const line = unquote(raw).replace(/`|\*\*/g, '').trim();
    if (!line) continue;
    if (first) { first = false; if (STATUS.test(line) && line.replace(STATUS, '').replace(/^\W+/, '') === '') continue; }
    for (const s0 of line.replace(BULLET, '').split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)) {
      const s = s0.trim();
      if (s.length < 8 || CITE.test(s) || !ASSERTIVE.test(s) || sentences.length >= MAX) continue;
      const o = outbound(s);
      if (o.bad) dropped++; else sentences.push(o.text);
    }
  }
  return { sentences, dropped };
}
