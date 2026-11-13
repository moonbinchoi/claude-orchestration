import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildQuery } from './query-build.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'qb-test-'));
const Q = { model: { type: 'choice', instructions: 'Pick one.', criteria: { a: 'A.', b: 'B.' } } };

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('summary only: state is {summary}', () => {
  const r = buildQuery({ alias: 'jev-x', summary: 'Rename a variable.', questions: Q });
  assert.deepEqual(r, { body: { model: 'jev-x', state: { summary: 'Rename a variable.' }, questions: Q }, dropped: [] });
});
test('any combination leaves questions identical', () => {
  const combos = [{}, { agentType: 'worker' }, { attributesText: 'Attributes: a=1' }, { agentType: 'worker', brief: '## Scope\na/b', attributesText: 'Attributes: a=1; b=two words' }];
  for (const c of combos) {
    const r = buildQuery({ alias: 'jev-x', summary: 'Rename a variable.', questions: Q, agentsDir: tmp(), ...c });
    assert.equal(JSON.stringify(r.body.questions), JSON.stringify(Q));
    assert.deepEqual(Object.keys(r.body.state), ['summary', ...(c.agentType ? ['facts'] : []), ...(c.attributesText ? ['attributes'] : [])]);
  }
});
test('dropped attributes are reported, request still built', () => {
  const r = buildQuery({ alias: 'jev-x', summary: 'Rename a variable.', questions: Q, attributesText: 'Attributes: a=1; b=two words' });
  assert.deepEqual(r.body.state, { summary: 'Rename a variable.', attributes: { a: 1 } });
  assert.deepEqual(r.dropped, [{ name: 'b', reason: 'bad_value' }]);
});
test('guarded summary: no request', () => {
  assert.deepEqual(buildQuery({ alias: 'jev-x', summary: 'Edit C:\\Users\\me\\a.txt now.', questions: Q }), { rejected: 'windows_path' });
  assert.deepEqual(buildQuery({ alias: 'jev-x', summary: 5, questions: Q }), { rejected: 'summary_not_string' });
});
test('every attribute dropped: no attributes key', () => {
  const r = buildQuery({ alias: 'jev-x', summary: 'Rename a variable.', questions: Q, attributesText: 'Attributes: pick=opus' });
  assert.deepEqual(r.body.state, { summary: 'Rename a variable.' });
  assert.deepEqual(r.dropped, [{ name: 'pick', reason: 'names_answer' }]);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
