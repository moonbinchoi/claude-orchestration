// PreToolUse hook: shows the commit procedure on the first commit per session and checks the commit trailer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { segments } from './shell-segments.mjs';

export const RECORD_DIR = path.join(os.tmpdir(), 'claude-commit-procedure');
export const PROCEDURE_PATH = fileURLToPath(new URL('./commit-procedure.md', import.meta.url));

const TRAILER = /^\s*Co-Authored-By: [^<\n]+ <[^>\s]+>\s*$/m;
const GIT_OR_GH = /git|gh/i;
const GLOBAL_WITH_VALUE = new Set(['--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const SKIP = new Set(['command', 'sudo', '{', '}', '!', 'then', 'do', 'else', 'time']);
const exeName = (w) => path.basename(w).toLowerCase().replace(/\.exe$/, '');

// Per-subcommand rules: the one place where a git/gh invocation's subcommand and words are known.
function checkInvocation(tool, sub, args, ctx) {
  if (tool === 'git' && sub === 'commit') return [...checkCommit(args, ctx), ...blocked(args, 'commit', 'mFCct', ['--no-verify', '--no-gpg-sign'], 'n'), ...checkConfig(ctx.globalOpts)];
  if (tool === 'git' && sub === 'push') {
    const v = blocked(args, 'push', 'o', ['--force', '--force-with-lease', '--force-if-includes', '--no-verify'], 'f');
    if (args.some((a) => a.startsWith('+'))) v.push('git push: + refspec forces the push.');
    return v;
  }
  if (tool === 'git' && sub === 'branch') return blocked(args, 'branch', '', ['--move'], 'mM');
  if (tool === 'gh' && sub === 'repo' && args[0] === 'edit') return blocked(args, 'gh repo edit', '', ['--default-branch'], '');
  if (tool === 'gh' && sub === 'api') return checkApi(args);
  return [];
}

// Expands args into options: --x=v -> --x; short bundles split per letter up to a letter that takes a value (rest of word or next word is its value).
function optionsOf(args, valueLetters) {
  const opts = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a.startsWith('--')) opts.push(a.split('=')[0]);
    else if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        opts.push('-' + a[k]);
        if (valueLetters.includes(a[k])) { if (k === a.length - 1) i++; break; }
      }
    }
  }
  return opts;
}

// Long options of 5+ chars that prefix a blocked long option count as that option.
const isBlocked = (o, longs, shorts) => (o.startsWith('--') ? longs.some((b) => o === b || (o.length >= 5 && b.startsWith(o))) : shorts.includes(o[1]));

function blocked(args, name, valueLetters, longs, shorts) {
  return optionsOf(args, valueLetters).filter((o) => isBlocked(o, longs, shorts)).map((o) => `${name}: option ${o} is blocked.`);
}

function checkConfig(globalOpts) {
  const v = [];
  for (let i = 0; i < globalOpts.length; i++) {
    if (globalOpts[i] !== '-c') continue;
    const [k, ...rest] = (globalOpts[i + 1] ?? '').split('=');
    const key = k.toLowerCase(); const val = rest.join('=').toLowerCase();
    if (key === 'core.hookspath' || (key === 'commit.gpgsign' && /^(false|no|off|0)$/.test(val))) v.push(`git -c ${k}: disables commit hooks or signing.`);
  }
  return v;
}

function checkApi(args) {
  const v = [];
  for (let i = 0; i < args.length; i++) {
    // value: attached (-fK=V, --field=K=V) or the next word (-f K=V, --field K=V)
    const m = /^(?:--(?:field|raw-field)(?:=(.*))?|-[fF](.+)?)$/s.exec(args[i]);
    if (m && (m[1] ?? m[2] ?? args[++i] ?? '').startsWith('default_branch=')) v.push('gh api: changing default_branch is blocked.');
    else if (!args[i].startsWith('-') && args[i].endsWith('/rename')) v.push('gh api: branch rename is blocked.');
  }
  return v;
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
  const res = { commit: false, git: false, claudecode: false, violations: [] };
  for (const seg of segments(command, shell)) {
    if (seg.words.some((w) => w.bare.includes('CLAUDECODE'))) res.claudecode = true;
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
        // powershell -Command takes all remaining words as the command
        const inner = ps ? scan(rest.slice(k + 1).join(' '), 'powershell', cwd, readFile) : scan(rest[k + 1], 'bash', cwd, readFile);
        res.commit ||= inner.commit; res.git ||= inner.git; res.claudecode ||= inner.claudecode; res.violations.push(...inner.violations);
      }
    } else if (tool === 'git' || tool === 'gh') {
      if (tool === 'git') res.git = true;
      let dir = cwd; let j = 0;
      const globalOpts = []; // git global options, e.g. ['-c', 'k=v'], for subcommand rules
      if (tool === 'git') {
        for (; j < rest.length && rest[j].startsWith('-'); j++) {
          if (rest[j] === '-C') { globalOpts.push(rest[j], rest[j + 1]); dir = path.resolve(dir, rest[++j] ?? '.'); }
          else if (rest[j] === '-c' || GLOBAL_WITH_VALUE.has(rest[j])) globalOpts.push(rest[j], rest[++j]);
          else globalOpts.push(rest[j]);
        }
      }
      const sub = rest[j];
      if (tool === 'git' && sub === 'commit') res.commit = true;
      res.violations.push(...checkInvocation(tool, sub, rest.slice(j + 1), { heredocs: seg.heredocs, dir, globalOpts, readFile }));
    }
  }
  return res;
}

export function decide({ command, sessionKey, cwd, shell = 'bash' }, { seen, readFile }) {
  if (!GIT_OR_GH.test(command)) return { decision: 'allow' };
  const { commit, git, claudecode, violations } = scan(command, shell, cwd ?? '.', readFile);
  if (git && claudecode) violations.push('CLAUDECODE: do not set or unset this environment variable.');
  if (commit && !seen(sessionKey)) {
    return { decision: 'deny', reason: [...violations, '', readFile(PROCEDURE_PATH)].join('\n').replace(/^\n/, ''), procedure: true };
  }
  return violations.length ? { decision: 'deny', reason: violations.join('\n') } : { decision: 'allow' };
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
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
    if (GIT_OR_GH.test(raw)) deny(`commit-guard hook error: ${e.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
