// PreToolUse hook: shows the commit procedure on the first commit per session and checks the commit trailer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { segments } from './shell-segments.mjs';

export const RECORD_DIR = path.join(os.tmpdir(), 'claude-commit-procedure');
export const PROCEDURE_PATH = fileURLToPath(new URL('./commit-procedure.md', import.meta.url));

const TRAILER = /^Co-Authored-By:[ \t]*\S.*<[^<>\s]+>[ \t]*$/im;
const SKIP = new Set(['command', 'sudo', '{', '}', '!', 'then', 'do', 'else', 'time']);
const exeName = (w) => path.basename(w).toLowerCase().replace(/\.exe$/, '');

// Per-subcommand rules: the one place where a git/gh invocation's subcommand and words are known.
function checkInvocation(tool, sub, args, ctx) {
  if (tool === 'git' && sub === 'commit') return checkCommit(args, ctx);
  return [];
}

function checkCommit(args, ctx) {
  const parts = [...ctx.heredocs];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    let m;
    if (w === '--message' || w === '--file') parts.push(...take(args[++i], w === '--file', ctx));
    else if ((m = /^--(message|file)=(.*)$/s.exec(w))) parts.push(...take(m[2], m[1] === 'file', ctx));
    else if ((m = /^-[a-zA-Z]*?([mF])(.*)$/s.exec(w)) && !w.startsWith('--')) {
      const val = m[2] || args[++i];
      parts.push(...take(val, m[1] === 'F', ctx));
    }
  }
  return TRAILER.test(parts.join('\n')) ? [] : ['git commit: no Co-Authored-By trailer in -m, heredoc or -F file. Add it with -m or a heredoc.'];
}

// -m value as is; -F value read from the file ('-' or unreadable: empty).
function take(val, isFile, ctx) {
  if (val === undefined) return [];
  if (!isFile) return [val];
  if (val === '-') return [];
  try { return [ctx.readFile(path.resolve(ctx.dir, val))]; } catch { return []; }
}

// Returns { commit: boolean, violations: string[] } for one command string.
function scan(command, shell, cwd, readFile) {
  const res = { commit: false, violations: [] };
  for (const seg of segments(command, shell)) {
    const words = seg.words.map((w) => w.text);
    let i = 0;
    for (; i < words.length; i++) {
      const w = words[i];
      if (/^[A-Za-z_]\w*=/.test(w) || SKIP.has(w)) continue;
      if (exeName(w) === 'env') {
        while (i + 1 < words.length && (words[i + 1].startsWith('-') || /^[A-Za-z_]\w*=/.test(words[i + 1]))) {
          if (words[++i] === '-u') i++;
        }
        continue;
      }
      break;
    }
    if (i >= words.length) continue;
    const tool = exeName(words[i]);
    const rest = words.slice(i + 1);
    if (tool === 'bash' || tool === 'sh' || tool === 'pwsh' || tool === 'powershell') {
      const ps = tool.startsWith('p');
      const k = rest.findIndex((a) => (ps ? /^-(c|command)$/i : /^-\w*c$/).test(a));
      if (k >= 0 && rest[k + 1] !== undefined) {
        const inner = scan(rest[k + 1], ps ? 'powershell' : 'bash', cwd, readFile);
        res.commit ||= inner.commit; res.violations.push(...inner.violations);
      }
    } else if (tool === 'git' || tool === 'gh') {
      let dir = cwd; let j = 0;
      if (tool === 'git') {
        for (; j < rest.length && rest[j].startsWith('-'); j++) {
          if (rest[j] === '-C') dir = path.resolve(dir, rest[++j] ?? '.');
          else if (rest[j] === '-c') j++;
        }
      }
      const sub = rest[j];
      if (tool === 'git' && sub === 'commit') res.commit = true;
      res.violations.push(...checkInvocation(tool, sub, rest.slice(j + 1), { heredocs: seg.heredocs, dir, readFile }));
    }
  }
  return res;
}

export function decide({ command, sessionKey, cwd, shell = 'bash' }, { seen, readFile }) {
  if (!/\b(git|gh)\b/.test(command)) return { decision: 'allow' };
  const { commit, violations } = scan(command, shell, cwd ?? '.', readFile);
  if (commit && !seen(sessionKey)) {
    return { decision: 'deny', reason: [...violations, '', readFile(PROCEDURE_PATH)].join('\n').replace(/^\n/, ''), procedure: true };
  }
  return violations.length ? { decision: 'deny', reason: violations.join('\n') } : { decision: 'allow' };
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  try {
    const input = JSON.parse(raw);
    const sessionKey = input.agent_id ? `${input.session_id}__${input.agent_id}` : input.session_id;
    const shell = input.tool_name === 'PowerShell' ? 'powershell' : 'bash';
    const r = decide(
      { command: input.tool_input?.command ?? '', sessionKey, cwd: input.cwd, shell },
      { seen: (k) => fs.existsSync(path.join(RECORD_DIR, k)), readFile: (p) => fs.readFileSync(p, 'utf8') },
    );
    if (r.procedure) { fs.mkdirSync(RECORD_DIR, { recursive: true }); fs.writeFileSync(path.join(RECORD_DIR, sessionKey), ''); }
    if (r.decision === 'deny') deny(r.reason);
  } catch (e) {
    if (/\b(git|gh)\b/.test(raw)) deny(`commit-guard hook error: ${e.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
