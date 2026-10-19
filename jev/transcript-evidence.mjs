// transcript-evidence: parse a subagent transcript into the brief and the ordered tool calls with their results.
// Only user/assistant entries count: api-request-blob lines repeat the same blocks and would double every call.

import { textOf } from './guard-common.mjs';

// truncated: the text starts mid-file, so its first user message is not the brief.
// Returns { brief: string|null, calls: [{ i, id, name, input, text, is_error, done }] }.
export function parseTranscript(text, { truncated = false } = {}) {
  let brief = null;
  const calls = [];
  const byId = new Map();
  for (const l of String(text).split('\n')) {
    const isTool = l.includes('tool_use') || l.includes('tool_result');
    if (!isTool && (brief !== null || truncated || !l.includes('"user"'))) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    const c = e?.message?.content;
    if (e?.type !== 'assistant' && e?.type !== 'user') continue;
    if (brief === null && !truncated && e.type === 'user' && !(Array.isArray(c) && c.some((b) => b?.type === 'tool_result'))) { brief = textOf(c); continue; }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type === 'tool_use') {
        const call = { i: calls.length, id: b.id, name: b.name, input: b.input ?? {}, text: '', is_error: false, done: false };
        calls.push(call);
        byId.set(b.id, call);
      } else if (b?.type === 'tool_result') {
        const call = byId.get(b.tool_use_id);
        if (call) Object.assign(call, { text: textOf(b.content), is_error: b.is_error === true, done: true });
      }
    }
  }
  return { brief, calls };
}
