import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hooks = path.dirname(fileURLToPath(import.meta.url));
const base = { ...process.env }; delete base.CLAUDECODE;
const git = (cwd, args, env = base) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, encoding: 'utf8' });
const HEAD = '{\n  "model": "opus",\n  "theme": "light"\n}\n';

function attempt(name, staged, claude, headText = HEAD) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-'));
  git(d, ['init', '-q', '-b', 'main']); git(d, ['config', 'core.hooksPath', hooks]);
  fs.writeFileSync(path.join(d, 'other.txt'), '1');
  if (headText !== null) fs.writeFileSync(path.join(d, 'settings.json'), headText);
  git(d, ['add', '-A']); git(d, ['commit', '-q', '-m', 'base']);
  if (staged === null) fs.writeFileSync(path.join(d, 'other.txt'), '2');
  else fs.writeFileSync(path.join(d, 'settings.json'), staged);
  git(d, ['add', '-A']);
  const r = git(d, ['commit', '-q', '-m', name], claude ? { ...base, CLAUDECODE: '1' } : base);
  fs.rmSync(d, { recursive: true, force: true });
  return r.status;
}

assert.notEqual(attempt('R11', HEAD.replace('opus', 'sonnet'), true), 0);
assert.notEqual(attempt('R11 new file', HEAD, true, null), 0);
assert.notEqual(attempt('R12', HEAD.replace('}', '  ,"enabledPlugins": { "SDLC@local": true }\n}'), true), 0);
assert.notEqual(attempt('bad json', '{ nope', true), 0);
assert.equal(attempt('other key', HEAD.replace('light', 'dark'), true), 0);
assert.equal(attempt('no settings change', null, true), 0);
assert.equal(attempt('R15 user', HEAD.replace('opus', 'sonnet'), false), 0);
console.log('pre-commit: ok');
