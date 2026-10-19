import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBreaker } from './breaker.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'br-test-'));
const state = (d) => JSON.parse(readFileSync(join(d, 'breaker.json'), 'utf8'));
let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('no call -> nothing written', () => {
  const d = tmp(); const b = createBreaker({ dir: d }); b.save();
  assert.equal(b.open, false); assert.equal(existsSync(join(d, 'breaker.json')), false);
});
test('opens after N consecutive failures for openMs', () => {
  const d = tmp(); const t = 1000;
  const b = createBreaker({ dir: d, now: () => t, failures: 3, openMs: 500 });
  b.fail(); b.fail(); b.save(); assert.deepEqual(state(d), { failures: 2, open_until: 0 });
  b.fail(); b.save(); assert.deepEqual(state(d), { failures: 3, open_until: 1500 });
  assert.equal(createBreaker({ dir: d, now: () => 1400 }).open, true);
  assert.equal(createBreaker({ dir: d, now: () => 1500 }).open, false);
});
test('success resets and is written', () => {
  const d = tmp(); writeFileSync(join(d, 'breaker.json'), JSON.stringify({ failures: 2, open_until: 0 }));
  const b = createBreaker({ dir: d }); b.ok(); b.save();
  assert.deepEqual(state(d), { failures: 0, open_until: 0 });
});
test('corrupt state file -> closed', () => {
  const d = tmp(); writeFileSync(join(d, 'breaker.json'), 'nope');
  assert.equal(createBreaker({ dir: d }).open, false);
});
test('thresholds not passed come from config.json', () => {
  const d = tmp(); writeFileSync(join(d, 'config.json'), JSON.stringify({ breakerFailures: 1, breakerOpenMs: 200 }));
  const b = createBreaker({ dir: d, now: () => 1000 });
  b.fail(); b.save(); assert.deepEqual(state(d), { failures: 1, open_until: 1200 });
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
