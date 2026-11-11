// SessionStart hook (matcher: compact|clear): deletes this session's commit-procedure records so the procedure shows again.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RECORD_DIR } from './commit-guard.mjs';

// Records are named `${sessionId}` or `${sessionId}__${agentId}`.
export function reset(dir, sessionId) {
  if (!sessionId || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name === sessionId || name.startsWith(`${sessionId}__`)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    try { reset(RECORD_DIR, JSON.parse(raw).session_id); } catch { /* fail open: a reset error must not block session start */ }
    process.exit(0);
  });
}
