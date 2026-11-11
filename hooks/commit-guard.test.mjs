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

// R13, R14 at the entry point
const hook = (stdin) => spawnSync(process.execPath, [fileURLToPath(new URL('./commit-guard.mjs', import.meta.url))], { input: stdin, encoding: 'utf8' });
const key = `guard-test-${process.pid}`;
let r = hook(JSON.stringify({ session_id: key, cwd: '.', tool_input: { command: 'git commit -m x' } }));
assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
assert.ok(fs.existsSync(path.join(RECORD_DIR, key))); fs.rmSync(path.join(RECORD_DIR, key));
r = hook('not json git'); assert.match(r.stdout, /"deny"/); assert.match(r.stdout, /hook error/);
r = hook('not json'); assert.equal(r.stdout, ''); assert.equal(r.status, 0);
r = hook(JSON.stringify({ session_id: key, tool_input: { command: 'echo hi' } })); assert.equal(r.stdout, ''); assert.equal(r.status, 0);
console.log('commit-guard: ok');
