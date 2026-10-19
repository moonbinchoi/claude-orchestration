// subagent-report: the final report of a subagent and its status line (DONE/PARTIAL/BLOCKED).
import { STATUS } from './guard-common.mjs';
import { readTail } from './transcript-read.mjs';

const statusOf = (msg) => (String(msg ?? '').split('\n').find((l) => l.trim()) ?? '').match(STATUS)?.[1] ?? null;

// message of the last SubagentHandback tool call in the subagent transcript, or null.
function handback(path, reader) {
  if (typeof path !== 'string') return null;
  let text;
  try { text = reader(path); } catch { return null; }
  let msg = null;
  for (const l of String(text).split('\n')) {
    if (!l.includes('SubagentHandback')) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    const c = e?.message?.content;
    if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_use' && b.name === 'SubagentHandback' && typeof b.input?.message === 'string') msg = b.input.message;
  }
  return msg;
}

// Some hosts (VS Code extension) deliver the report as a SubagentHandback tool call, leaving last_assistant_message empty.
export function readReport(input, reader = (path) => readTail(path).text) {
  const lam = input?.last_assistant_message;
  const own = typeof lam === 'string' && lam.trim() ? lam : null;
  const text = own && statusOf(own) ? own : handback(input?.agent_transcript_path, reader) ?? own ?? '';
  return { text, status: statusOf(text) ?? 'unknown' };
}
