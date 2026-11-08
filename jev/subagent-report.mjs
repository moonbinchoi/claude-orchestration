// subagent-report: the final report of a subagent and its status line (DONE/PARTIAL/BLOCKED).
import { STATUS } from './guard-common.mjs';
import { readTail } from './transcript-read.mjs';

const statusOf = (msg) => (String(msg ?? '').split('\n').find((l) => l.trim()) ?? '').match(STATUS)?.[1] ?? null;

// message of the last SubagentHandback tool call of the current round, or null. A user line with string content
// (a resume prompt) starts a new round, so a handback before it belongs to the previous round.
function handback(path, reader) {
  if (typeof path !== 'string') return null;
  let text;
  try { text = reader(path); } catch { return null; }
  let msg = null;
  for (const l of String(text).split('\n')) {
    if (!l.includes('SubagentHandback') && !l.includes('"type":"user"')) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    const c = e?.message?.content;
    if (e?.type === 'user' && typeof c === 'string') msg = null;
    // only assistant lines: api-request-blob lines replay earlier turns, including an old handback
    if (e?.type === 'assistant' && Array.isArray(c)) for (const b of c) if (b?.type === 'tool_use' && b.name === 'SubagentHandback' && typeof b.input?.message === 'string') msg = b.input.message;
  }
  return msg;
}

// Some hosts (VS Code extension) deliver the report as a SubagentHandback tool call, leaving last_assistant_message empty.
// pending: a transcript exists but holds no current handback yet (the host may still be writing it); the caller may re-read.
export function readReport(input, reader = (path) => readTail(path).text) {
  const lam = input?.last_assistant_message;
  const own = typeof lam === 'string' && lam.trim() ? lam : null;
  if (own && statusOf(own)) return { text: own, status: statusOf(own), pending: false };
  const path = input?.agent_transcript_path;
  const hb = handback(path, reader);
  const text = hb ?? own ?? '';
  return { text, status: statusOf(text) ?? 'unknown', pending: hb === null && typeof path === 'string' };
}
