process.env.TYPESAFE_API_KEY = 'test-key-not-real';
import assert from 'node:assert/strict';
import { formatItem } from './ask-format.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const choiceQ = { length: { type: 'choice', instructions: 'x', criteria: { keep: 'a', shorten: 'b' } } };
const ch = (keep, shorten) => ({ length: { choice: 'keep', probabilities: { keep, shorten }, confidence: 1 } });
const noulQ = { ok: { type: 'noul', instructions: 'x' } };
const noul = (p) => ({ ok: { noul: p } });
const withComp = { ...choiceQ, length_fits: { type: 'noul', instructions: 'x' } };
const comp = { length_fits: 'length' };

test('choice line', () => {
  const r = formatItem('pr_1', choiceQ, {}, ch(0.62, 0.38));
  assert.deepEqual(r, { lines: ['Jev pr_1.length: keep 0.62 (shorten 0.38)'], top_p: [0.62] });
});
test('choice ranks by p descending', () => {
  const r = formatItem('pr_1', choiceQ, {}, ch(0.3, 0.7));
  assert.equal(r.lines[0], 'Jev pr_1.length: shorten 0.70 (keep 0.30)');
});
test('low_p', () => {
  assert.equal(formatItem('pr_1', choiceQ, {}, ch(0.55, 0.45)).lines[0],
    'Jev pr_1.length: keep 0.55 (shorten 0.45); unsure: low_p');
});
test('score line', () => {
  const q = { sev: { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c'] } };
  const a = { sev: { score: 1.62, probabilities: { 0: 0.11, 1: 0.31, 2: 0.58 }, confidence: 1 } };
  const r = formatItem('pr_1', q, {}, a);
  assert.deepEqual(r, { lines: ['Jev pr_1.sev: score 1.62, level 2 0.58 (level 1 0.31); unsure: low_p'], top_p: [0.58] });
});
test('noul yes/no/band', () => {
  assert.equal(formatItem('i', noulQ, {}, noul(0.82)).lines[0], 'Jev i.ok: p 0.82 yes');
  assert.equal(formatItem('i', noulQ, {}, noul(0.2)).lines[0], 'Jev i.ok: p 0.20 no');
  assert.equal(formatItem('i', noulQ, {}, noul(0.5)).lines[0], 'Jev i.ok: p 0.50; unsure: noul_band');
  assert.deepEqual(formatItem('i', noulQ, {}, noul(0.5)).top_p, [0.5]);
});
test('threshold boundaries', () => {
  assert.equal(formatItem('i', choiceQ, {}, ch(0.6, 0.4)).lines[0], 'Jev i.length: keep 0.60 (shorten 0.40)');
  assert.equal(formatItem('i', noulQ, {}, noul(0.7)).lines[0], 'Jev i.ok: p 0.70 yes');
  assert.equal(formatItem('i', noulQ, {}, noul(0.3)).lines[0], 'Jev i.ok: p 0.30 no');
  assert.equal(formatItem('i', choiceQ, {}, ch(0.5999, 0.4001)).lines[0],
    'Jev i.length: keep 0.60 (shorten 0.40); unsure: low_p');
});
test('companion low', () => {
  const a = { ...ch(0.8, 0.2), length_fits: { noul: 0.4 } };
  const r = formatItem('pr_1', withComp, comp, a);
  assert.deepEqual(r.lines, [
    'Jev pr_1.length: keep 0.80 (shorten 0.20); unsure: no_option_fits',
    'Jev pr_1.length_fits: p 0.40 companion of length',
  ]);
  assert.deepEqual(r.top_p, [0.8, 0.4]);
});
test('companion ok -> no mark', () => {
  const a = { ...ch(0.8, 0.2), length_fits: { noul: 0.7 } };
  assert.equal(formatItem('i', withComp, comp, a).lines[0], 'Jev i.length: keep 0.80 (shorten 0.20)');
});
test('companion missing', () => {
  const r = formatItem('pr_1', withComp, comp, ch(0.8, 0.2));
  assert.deepEqual(r.lines, ['Jev pr_1.length: keep 0.80 (shorten 0.20); unsure: companion_missing']);
  assert.deepEqual(r.top_p, [0.8, null]);
});
test('two marks', () => {
  const a = { ...ch(0.55, 0.45), length_fits: { noul: 0.4 } };
  assert.equal(formatItem('i', withComp, comp, a).lines[0],
    'Jev i.length: keep 0.55 (shorten 0.45); unsure: low_p, no_option_fits');
});
test('prototype key question', () => {
  const qs = { constructor: choiceQ.length, tostring_fits: withComp.length_fits };
  const a = { constructor: ch(0.8, 0.2).length, tostring_fits: { noul: 0.4 } };
  const r = formatItem('i', qs, { tostring_fits: 'constructor' }, a);
  assert.deepEqual(r.lines, [
    'Jev i.constructor: keep 0.80 (shorten 0.20); unsure: no_option_fits',
    'Jev i.tostring_fits: p 0.40 companion of constructor',
  ]);
  const plain = formatItem('i', { constructor: noulQ.ok }, {}, { constructor: { noul: 0.82 } });
  assert.deepEqual(plain.lines, ['Jev i.constructor: p 0.82 yes']);
});

for (const [name, fn] of cases) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
console.log(`${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
