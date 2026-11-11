import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reset } from './commit-procedure-reset.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-test-'));
for (const f of ['s1', 's1__a1', 's2', 's10']) fs.writeFileSync(path.join(dir, f), '');
reset(dir, 's1');
assert.deepEqual(fs.readdirSync(dir).sort(), ['s10', 's2']);
reset(path.join(dir, 'missing'), 's1'); // no throw
fs.rmSync(dir, { recursive: true });
console.log('commit-procedure-reset: ok');
