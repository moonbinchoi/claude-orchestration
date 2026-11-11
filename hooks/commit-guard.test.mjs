import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, PROCEDURE_PATH, RECORD_DIR } from './commit-guard.mjs';

const T = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const PROC = '# Commit procedure\n## All repositories\n## ~/.claude\n';
const files = { [path.resolve(PROCEDURE_PATH)]: PROC, [path.resolve('E:/r/ok.txt')]: `x\n\n${T}\n`, [path.resolve('E:/r/no.txt')]: 'x\n' };
const readFile = (p) => { const v = files[path.resolve(p)]; if (v === undefined) throw new Error('ENOENT'); return v; };
const run = (command, seen = true, cwd = 'E:/r') => decide({ command, sessionKey: 's', cwd }, { seen: () => seen, readFile });
const hd = (msg) => `git commit -m "$(cat <<'EOF'\n${msg}\nEOF\n)"`;
const ok = `git commit -m "x\n\n${T}"`;

// R1, R2, R3
const first = run(ok, false);
assert.equal(first.decision, 'deny'); assert.ok(first.reason.includes(PROC)); assert.equal(first.procedure, true);
assert.equal(run(ok, true).decision, 'allow');
assert.equal(run('git status', false).decision, 'allow');
const both = run('git commit -m x', false);
assert.ok(both.reason.indexOf('Co-Authored-By') < both.reason.indexOf(PROC)); // violation before procedure
assert.equal(decide({ command: 'cd "C:\r\\"; git commit -m x', sessionKey: 's', cwd: 'E:/r', shell: 'powershell' }, { seen: () => true, readFile }).decision, 'deny');
assert.equal(run(`{ git commit -m x; }`).decision, 'deny');

const table = [
  // R9 allow
  [ok, 'allow'], [`git commit -m "fix: x" -m "${T}"`, 'allow'],
  [hd(`fix: a "quoted" (paren) it's\n\n${T}`), 'allow'],
  [`git commit -F - <<'EOF'\nx\n\n${T}\nEOF`, 'allow'],
  [`git -C E:/r commit -F ok.txt`, 'allow'], [`git commit -m @'\nx\n\n${T}\n'@`, 'allow'],
  [`git commit -am "x\n\n${T}"`, 'allow'],
  [`cd ~/.claude && git add a && git commit -m "x\n\n${T}"`, 'allow'],
  // R9 deny
  ['git commit -m x', 'deny'], ['git commit --amend --no-edit', 'deny'], ['git commit -C HEAD', 'deny'],
  ['git commit --fixup HEAD', 'deny'], ['git commit -F no.txt', 'deny'], ['git commit -F missing.txt', 'deny'],
  ['cat m | git commit -F -', 'deny'], [`echo "${T}" && git commit -m x`, 'deny'],
  ['git commit -m "x\n\nCo-Authored-By: someone"', 'deny'], [`(cd x && git commit -m y)`, 'deny'],
  // R14 and read-only
  ['echo hi', 'allow'], ['npm test', 'allow'], ['git log --oneline -5', 'allow'], ['gh pr view 3', 'allow'],
];
for (const [c, want] of table) assert.equal(run(c).decision, want, c);
assert.match(run('git commit -m x').reason, /-m/);

// fix round 1
const ps = (command) => decide({ command, sessionKey: 's', cwd: 'E:/r', shell: 'powershell' }, { seen: () => true, readFile }).decision;
assert.equal(run('git commit -m "x\n Co-Authored-By: A <a@b.c>"').decision, 'allow');
assert.equal(run('git commit -m "x\n\nCo-Authored-By: A<a@b.c>"').decision, 'deny');
assert.equal(run('git commit -m "x\n\nco-authored-by: A <a@b.c>"').decision, 'deny');
assert.equal(ps('GIT commit -m x'), 'deny'); assert.equal(ps('Git.exe commit -m x'), 'deny');
assert.equal(ps('pwsh -NoProfile -Command git commit -m x'), 'deny');
assert.equal(ps('pwsh -Command "git commit -m x"'), 'deny');
assert.equal(run('git --git-dir .git commit -m x').decision, 'deny');
assert.equal(run('git --work-tree w commit -m x').decision, 'deny');
assert.equal(run('bash -c "git commit -m x"').decision, 'deny');
assert.equal(run('env A=1 git commit -m x').decision, 'deny');
assert.equal(run('git -C E:/r commit -F ok.txt', true, 'E:/other').decision, 'allow');
assert.equal(run('git commit -F ok.txt', true, 'E:/other').decision, 'deny');
assert.equal(run('gh pr view 3').decision, 'allow');

// R13, R14 at the entry point
const hook = (stdin) => spawnSync(process.execPath, [fileURLToPath(new URL('./commit-guard.mjs', import.meta.url))], { input: stdin, encoding: 'utf8' });
const key = `guard-test-${process.pid}`;
let r = hook(JSON.stringify({ session_id: key, cwd: '.', tool_input: { command: 'git commit -m x' } }));
assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
assert.ok(fs.existsSync(path.join(RECORD_DIR, key))); fs.rmSync(path.join(RECORD_DIR, key));
r = hook('not json git'); assert.match(r.stdout, /"deny"/); assert.match(r.stdout, /hook error/);
r = hook('not json'); assert.equal(r.stdout, ''); assert.equal(r.status, 0);
r = hook(JSON.stringify({ session_id: key, tool_input: { command: 'echo hi' } })); assert.equal(r.stdout, ''); assert.equal(r.status, 0);
const akey = `${key}__ag`;
hook(JSON.stringify({ session_id: key, agent_id: 'ag', cwd: '.', tool_input: { command: 'git commit -m x' } }));
assert.ok(fs.existsSync(path.join(RECORD_DIR, akey))); fs.rmSync(path.join(RECORD_DIR, akey));
// Task 5: blocked options
const m = `-m "x\n\n${T}"`;
const table2 = [
  // R5
  [`git commit --no-verify ${m}`, 'deny'], [`git commit -n ${m}`, 'deny'], [`git commit -anm "x\n\n${T}"`, 'deny'],
  [`git commit --no-verif ${m}`, 'deny'], [`git commit --no-gpg-sign ${m}`, 'deny'],
  [`git -c commit.gpgsign=false commit ${m}`, 'deny'], [`git -c commit.gpgSign=no commit ${m}`, 'deny'],
  [`git -c core.hooksPath=/dev/null commit ${m}`, 'deny'], [`git -c commit.gpgsign=true commit ${m}`, 'allow'],
  [`git commit -m "docs: ban --no-verify, --force and CLAUDECODE edits\n\n${T}"`, 'allow'],
  // R6
  ['git push -f', 'deny'], ['git push --force origin main', 'deny'], ['git push --force-with-lease', 'deny'],
  ['git push --force-with-lease=main origin main', 'deny'], ['git push --force-if-includes', 'deny'],
  ['git push --no-verify', 'deny'], ['git push origin +main', 'deny'], ['git push -uf origin main', 'deny'],
  ['git push --forc', 'deny'], ['git push -o ci.skip origin main', 'allow'],
  ['git push origin main', 'allow'], ['git push -u origin feat', 'allow'],
  // R7
  ['git branch -m a b', 'deny'], ['git branch -M a b', 'deny'], ['git branch --move a b', 'deny'],
  ['git branch -d old', 'allow'], ['git branch --list', 'allow'],
  // R8
  ['gh repo edit --default-branch dev', 'deny'], ['gh repo edit --default-branch=dev', 'deny'],
  ['gh api -X PATCH repos/o/r -f default_branch=dev', 'deny'], ['gh api repos/o/r --field default_branch=dev', 'deny'],
  ['gh api repos/o/r/branches/a/rename -f new_name=b', 'deny'],
  ['gh api repos/o/r --jq .default_branch', 'allow'], ['gh repo view', 'allow'],
  // R10
  [`CLAUDECODE= git commit ${m}`, 'deny'], [`env -u CLAUDECODE git commit ${m}`, 'deny'],
  [`$env:CLAUDECODE=''; git commit ${m}`, 'deny'], [`unset CLAUDECODE; git commit ${m}`, 'deny'],
  [`Remove-Item env:CLAUDECODE; git commit ${m}`, 'deny'], ['export CLAUDECODE=0 && git push origin main', 'deny'],
  ['echo $CLAUDECODE', 'allow'],
  // nested shells
  [`bash -c "git push --force"`, 'deny'], [`pwsh -Command "git branch -M a b"`, 'deny'],
  // fix round 1: attached gh api field flags
  ['gh api repos/o/r -fdefault_branch=dev', 'deny'], ['gh api repos/o/r -Fdefault_branch=dev', 'deny'],
  ['gh api repos/o/r --raw-field=default_branch=dev', 'deny'], ['gh api repos/o/r -F per_page=5', 'allow'],
  ['gh api repos/o/r -f=default_branch=dev', 'deny'], ['gh api repos/o/r -F=default_branch=dev', 'deny'],
];
for (const [c, want] of table2) assert.equal(run(c).decision, want, c);
// fix round 2: Windows env var names are case-insensitive
assert.equal(ps(`$env:claudecode=''; git commit -m @'\nx\n\n${T}\n'@`), 'deny');
assert.equal(ps(`Remove-Item Env:ClaudeCode; git commit -m @'\nx\n\n${T}\n'@`), 'deny');
console.log('commit-guard: ok');
