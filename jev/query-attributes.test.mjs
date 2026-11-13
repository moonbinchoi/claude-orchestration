import assert from 'node:assert/strict';
import { parseAttributes } from './query-attributes.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('reads typed values', () => {
  const r = parseAttributes('Summary: x\nAttributes: files_to_change=3; cause_known=false; kind=refactor\n');
  assert.deepEqual(r, { attributes: { files_to_change: 3, cause_known: false, kind: 'refactor' }, dropped: [] });
});
test('no line or empty line: nothing', () => {
  assert.deepEqual(parseAttributes('Summary: x'), { attributes: {}, dropped: [] });
  assert.deepEqual(parseAttributes('Attributes:'), { attributes: {}, dropped: [] });
  assert.deepEqual(parseAttributes(undefined), { attributes: {}, dropped: [] });
});
test('drops only the bad item, keeps reasons without values', () => {
  const r = parseAttributes('Attributes: a=1; note=two words; b; c=x=y; a=2; Bad=1; model_hint=1; pick=opus; n=1e999; m=NaN; neg=-3; half=0.5');
  assert.deepEqual(r.attributes, { a: 1, neg: -3, half: 0.5 });
  assert.deepEqual(r.dropped, [
    { name: 'note', reason: 'bad_value' }, { name: null, reason: 'bad_item' }, { name: 'c', reason: 'bad_value' },
    { name: 'a', reason: 'duplicate' }, { name: null, reason: 'bad_item' }, { name: 'model_hint', reason: 'names_answer' },
    { name: 'pick', reason: 'names_answer' }, { name: 'n', reason: 'bad_value' }, { name: 'm', reason: 'bad_value' },
  ]);
});
test('ninth and later are too_many', () => {
  const r = parseAttributes('Attributes: ' + Array.from({ length: 10 }, (_, i) => `k${i}=1`).join('; '));
  assert.equal(Object.keys(r.attributes).length, 8);
  assert.deepEqual(r.dropped, [{ name: 'k8', reason: 'too_many' }, { name: 'k9', reason: 'too_many' }]);
});
test('only the first Attributes line is read; CRLF and a digit run too large for a finite number', () => {
  const r = parseAttributes('Attributes: a=1; big=' + '9'.repeat(400) + '\r\nAttributes: b=2\r\n');
  assert.deepEqual(r, { attributes: { a: 1 }, dropped: [{ name: 'big', reason: 'bad_value' }] });
  assert.deepEqual(parseAttributes('attributes: a=1'), { attributes: {}, dropped: [] });
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
