import assert from 'node:assert/strict';
import { outbound } from './outbound.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('redacts, caps at 200 and passes clean text', () => {
  assert.deepEqual(outbound('Edited a.mjs in C:/Users/x/y.mjs fine.'), { text: 'Edited a.mjs in <path> fine.', bad: null });
  assert.equal(outbound('x '.repeat(200)).text.length <= 200, true);
});
test('rejects CJK and fenced code', () => {
  assert.equal(outbound('All tests pass 통과').bad, 'cjk');
  assert.equal(outbound('see ```x``` here').bad, 'code_fence');
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
