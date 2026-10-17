// Orchestration guard for ~/.claude/ORCHESTRATION.md.
// Blocks the main session when it keeps working directly without delegating or saying why.
// Hook events: PreToolUse, Stop. Usage: node orchestration-guard.js [ask|deny]
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE = process.argv[2] === 'deny' ? 'deny' : 'ask';
const BUDGET = 8; // direct calls allowed per user prompt before the first block
const REPEAT = 8; // block again every REPEAT direct calls after that
const SMALL_EDIT_LINES = 5; // ORCHESTRATION.md: "An Edit of at most 5 lines to a file already read in this session"
const NOTICE = 'Delegation exception:';
const DIRECT = new Set(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch']);
const DELEGATE = new Set(['Agent', 'SendMessage']);

const norm = (f) => path.resolve(String(f)).toLowerCase();
const lines = (s) => (s ? String(s).split('\n').length : 0);

// Active only in projects whose CLAUDE.md imports ORCHESTRATION.md: the import is the single switch.
function enabled(cwd) {
  for (let d = path.resolve(cwd || '.'); ; d = path.dirname(d)) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]) {
      try {
        if (fs.readFileSync(path.join(d, f), 'utf8').includes('ORCHESTRATION.md')) return true;
      } catch (e) {
        // no such file
      }
    }
    if (d === path.dirname(d)) return false;
  }
}

// Notice in the final message or anywhere in this prompt's assistant text.
// Assistant transcript entries carry no promptId, so scan everything after the prompt's first entry.
function noticed(input) {
  if (String(input.last_assistant_message || '').includes(NOTICE)) return true;
  if (!input.prompt_id || !input.transcript_path) return false;
  let raw;
  try {
    raw = fs.readFileSync(input.transcript_path, 'utf8');
  } catch (e) {
    return false; // no transcript: final message only
  }
  const es = raw.split('\n').map((l) => {
    try { return JSON.parse(l); } catch (e) { return {}; } // blank or half-written line
  });
  const start = es.findIndex((e) => e.promptId === input.prompt_id);
  return start >= 0 && es.slice(start).some((e) => e.type === 'assistant'
    && Array.isArray(e.message && e.message.content)
    && e.message.content.some((c) => c.type === 'text' && String(c.text).includes(NOTICE)));
}

function run(input) {
  if (input.agent_id) return null; // fired inside a subagent
  if (!enabled(input.cwd)) return null;

  // ponytail: append-only log per session, never cleaned up; prune os.tmpdir()/claude-orch-guard if it grows
  const dir = path.join(os.tmpdir(), 'claude-orch-guard');
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, `${input.session_id}.jsonl`);
  const append = (e) => fs.appendFileSync(log, JSON.stringify(e) + '\n');
  const events = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

  const p = input.prompt_id || 'none';
  const mine = events.filter((e) => e.p === p);
  // only calls after the prompt's last delegation count
  const since = mine.slice(mine.map((e) => e.k).lastIndexOf('deleg') + 1);
  let direct = since.filter((e) => e.k === 'direct').length;

  if (input.hook_event_name === 'Stop') {
    if (direct <= BUDGET || input.stop_hook_active) return null;
    if (noticed(input)) return null;
    return {
      decision: 'block',
      reason: `ORCHESTRATION.md: ${direct} direct tool calls since the last delegation, and no "${NOTICE} <reason>" line this turn. Add it.`,
    };
  }


  const tool = input.tool_name;
  const ti = input.tool_input || {};
  if (DELEGATE.has(tool)) return append({ p, k: 'deleg' }), null;
  if (!DIRECT.has(tool)) return null;
  if ((tool === 'Bash' || tool === 'PowerShell') && String(ti.command || '').trimStart().startsWith('git ')) return null;

  const wasRead = (f) => events.some((e) => e.k === 'read' && e.f === norm(f));
  if (tool === 'Read' && ti.file_path) append({ k: 'read', f: norm(ti.file_path) });
  if (tool === 'Edit' && !ti.replace_all && wasRead(ti.file_path)
    && lines(ti.old_string) <= SMALL_EDIT_LINES && lines(ti.new_string) <= SMALL_EDIT_LINES) return null;

  append({ p, k: 'direct' });
  direct += 1;
  if (direct <= BUDGET) return null;
  if (noticed(input)) return null;
  const lastBlock = since.filter((e) => e.k === 'block').pop();
  if (lastBlock && direct - lastBlock.n < REPEAT) return null;

  append({ p, k: 'block', n: direct });
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: MODE,
      permissionDecisionReason: `ORCHESTRATION.md: ${direct} direct tool calls since the last delegation. Delegate to a subagent, or state "${NOTICE} <reason>" and continue.`,
    },
  };
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const out = run(JSON.parse(raw));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (e) {
    // fail open: a guard bug must not block the session
  }
});
