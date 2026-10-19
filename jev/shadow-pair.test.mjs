import assert from 'node:assert/strict';
import { shadowPair } from './shadow-pair.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('absence rules get a fixed sentence naming what was not found', () => {
  assert.equal(shadowPair({ original: 'c' }, { rule: 'no_test_run', evidence: '' }).evidence, 'No test or build command appears in the tool log.');
  assert.equal(shadowPair({ original: 'c', files: ['a.mjs'] }, { rule: 'no_edit_for_file', evidence: 'no write found for a.mjs, b.js' }).evidence, 'No Edit or Write call touched a.mjs, b.js.');
  assert.equal(shadowPair({ original: 'c', url: 'https://www.docs.example.com/x' }, { rule: 'no_fetch', evidence: '' }).evidence, 'No WebFetch of docs.example.com appears in the tool log.');
  assert.equal(shadowPair({ original: 'c', url: null }, { rule: 'no_fetch', evidence: '' }).evidence, 'No WebFetch call appears in the tool log.');
});
test('other rules use the local evidence line, with a fallback', () => {
  assert.deepEqual(shadowPair({ original: 'c' }, { rule: 'run_matches', evidence: 'node a.test.mjs' }), { claim: 'c', evidence: 'node a.test.mjs' });
  assert.equal(shadowPair({ original: 'c' }, { rule: 'zzz', evidence: '' }).evidence, 'No evidence line was recorded.');
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
