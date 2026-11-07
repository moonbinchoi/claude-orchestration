// SessionStart: catch what the Write|Edit validator (frontmatter-validate.mjs) cannot see, and setup that upgrades can undo.
// 1. Agents/skills written by git, editors or shell commands: Claude Code drops a file whose frontmatter fails strict YAML without a word.
// 2. Git Bash zoneinfo copied by hand (2026-11-08); a Git for Windows reinstall may remove it and TZ=Asia/Seoul falls back to UTC.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function dirsToCheck(cwd, home = os.homedir()) {
  const roots = [path.join(home, '.claude'), cwd && path.join(cwd, '.claude')].filter(Boolean);
  const dirs = roots.flatMap((r) => ['agents', 'skills'].map((d) => path.join(r, d)));
  return [...new Set(dirs.map((d) => path.resolve(d)))].filter((d) => fs.existsSync(d));
}

const validate = (dir) =>
  new Promise((resolve) =>
    execFile('claude', ['plugin', 'validate', dir], { timeout: 20000 }, (err, stdout, stderr) =>
      // a missing or timed-out validator says nothing about the files: only a real exit 1 counts
      resolve(err && typeof err.code === 'number' ? `${dir}\n${stdout}${stderr}` : null)));

function zoneinfoProblem() {
  let exec;
  try { exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(); } catch { return null; }
  const root = path.resolve(exec, '..', '..', '..'); // <Git>/mingw64/libexec/git-core
  const seoul = path.join(root, 'usr', 'share', 'zoneinfo', 'Asia', 'Seoul');
  if (!fs.existsSync(path.join(root, 'usr', 'bin'))) return null; // not Git for Windows
  return fs.existsSync(seoul) ? null : `Git Bash has no ${seoul}: TZ=Asia/Seoul prints UTC. Copy the Python tzdata zoneinfo folder there again (elevated), see docs/research/lesson-model-test-2026-11-07/improvements.md D3 in E:/Study/Inflearn.`;
}

async function main(raw) {
  let cwd;
  try { cwd = JSON.parse(raw || '{}').cwd; } catch {}
  const failures = (await Promise.all(dirsToCheck(cwd || process.cwd()).map(validate))).filter(Boolean);
  const problems = [], summary = [];
  if (failures.length) {
    problems.push(`claude plugin validate failed; the files named below will not load:\n${failures.join('\n')}`);
    summary.push(`Agent/skill frontmatter invalid in: ${failures.map((f) => f.split('\n')[0]).join(', ')}`);
  }
  const tz = zoneinfoProblem();
  if (tz) { problems.push(tz); summary.push('Git Bash zoneinfo missing (TZ=Asia/Seoul prints UTC)'); }
  if (!problems.length) return;
  process.stdout.write(JSON.stringify({ systemMessage: summary.join(' | '), hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: problems.join('\n\n') } }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => main(raw).catch(() => {})); // fail open
}
