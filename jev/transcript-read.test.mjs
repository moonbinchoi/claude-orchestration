import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTail } from './transcript-read.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const f = join(mkdtempSync(join(tmpdir(), 'jev-test-')), 't.jsonl');

test('small file read whole', () => {
  writeFileSync(f, 'abcdef');
  assert.deepEqual(readTail(f), { text: 'abcdef', bytes: 6, truncated: false });
});
test('over the cap: only the tail, truncated true', () => {
  writeFileSync(f, 'abcdef');
  assert.deepEqual(readTail(f, 4), { text: 'cdef', bytes: 6, truncated: true });
});
test('missing file throws', () => {
  assert.throws(() => readTail(join(f, 'nope')));
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
