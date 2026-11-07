import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirsToCheck } from './session-check.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
const home = path.join(tmp, 'home'), proj = path.join(tmp, 'proj');
fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
fs.mkdirSync(path.join(proj, '.claude', 'skills'), { recursive: true });
// existing dirs only, global and project, no duplicates when cwd is home
assert.deepEqual(dirsToCheck(proj, home), [
  path.join(home, '.claude', 'agents'), path.join(home, '.claude', 'skills'), path.join(proj, '.claude', 'skills')]);
assert.equal(dirsToCheck(home, home).length, 2);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('session-check: ok');
