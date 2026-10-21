// main-pick-trigger: UserPromptSubmit handler. On the first prompt of an interactive session it returns additionalContext
// that makes the main session summarise, run main-pick.mjs, show the line, and stop unless the pick matches the running model. Always on. Fail-open: any problem returns null.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENTRYPOINTS = ['cli', 'claude-vscode'];

export const TEXT = [
  'First prompt of this session: first run the model pick below; start the requested work only as step 4 allows.',
  '1) Write a 1-2 sentence English summary of the requested work, with secrets, paths, URLs, emails, names and code removed. Use no slashes, quotes, backslashes, dollar signs or backticks.',
  '2) Run this with the Bash tool, replacing <summary> with your summary:',
  'node C:/Users/skyra/.claude/jev/main-pick.mjs "<summary>"',
  '3) Show the user the output line as is. If it starts with "Jev failed", or the command fails, is denied, or prints anything other than one line starting with "Jev:", state the cause and ask the user whether to proceed.',
  '4) Otherwise compare the first model name after \"Jev:\" in the line (haiku, sonnet or opus; ignore the runner-up in parentheses) with the model you are running on, known from your system prompt. Effort is not compared. If they are the same, say in one short line that the model already matches, then continue with the requested work in this same turn. If they differ, tell the user they can switch with /model and /effort and then tell you to proceed, and end the turn without doing any of the requested work, calling other tools, or dispatching subagents.',
].join('\n');

// true when the transcript holds an assistant entry; missing or unreadable = false. Whole file: a session's first
// assistant entry can sit past 320 KB (seen live), and a fresh session's transcript is tiny.
function hasAssistant(path) {
  try { return /"type"\s*:\s*"assistant"/.test(readFileSync(path, 'utf8')); } catch { return false; }
}

export function onPrompt(input, { dir, env = process.env, now = Date.now } = {}) {
  const entrypoint = env.CLAUDE_CODE_ENTRYPOINT ?? null;
  // undocumented: '1' in an interactive session, '0' in `claude -p` (which inherits the parent's ENTRYPOINT when nested)
  const attended = env.CLAUDE_CODE_SESSION_ATTENDED ?? null;
  const sid = typeof input?.session_id === 'string' ? input.session_id : null;
  const decide = (fired, skip_reason = null) => {
    try { appendFileSync(join(dir, 'main-pick.jsonl'), JSON.stringify({ ts: new Date(now()).toISOString(), kind: 'trigger', fired, skip_reason, entrypoint, attended, session_id: sid }) + '\n'); } catch { /* ignore */ }
    return fired ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: TEXT } } : null;
  };
  try {
    if (!ENTRYPOINTS.includes(entrypoint)) return decide(false, 'entrypoint');
    if (attended === '0') return decide(false, 'unattended');
    if (!sid) return decide(false, 'no_session_id');
    if (!/^[A-Za-z0-9_-]+$/.test(sid)) return decide(false, 'bad_session_id');
    // ponytail: markers are never pruned; one empty file per session, delete old ones by hand if the dir grows
    const markerDir = join(dir, 'main-pick-seen');
    try { mkdirSync(markerDir, { recursive: true }); } catch { return decide(false, 'marker_write_failed'); }
    try { writeFileSync(join(markerDir, sid), '', { flag: 'wx' }); } catch (e) {
      return decide(false, e?.code === 'EEXIST' ? 'seen' : 'marker_write_failed');
    }
    if (typeof input.transcript_path === 'string' && hasAssistant(input.transcript_path)) return decide(false, 'resumed_session');
    return decide(true);
  } catch { return null; }
}
