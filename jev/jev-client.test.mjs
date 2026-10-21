import assert from 'node:assert/strict';
import { systemOne, JevError } from './jev-client.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
process.env.TYPESAFE_API_KEY = 'test-key-not-real';
const fetchOf = (obj) => async () => new Response(JSON.stringify(obj), { status: 200 });
const call = (questions, answers, state = 'Rename one variable.') => systemOne({ body: { model: 'm', state, questions }, fetchImpl: fetchOf({ model: 'm', answers }) });
const rejects = async (p, msg) => { await assert.rejects(p, (e) => e instanceof JevError && e.reason === 'invalid_response' && e.message.includes(msg)); };

const NOUL = { same: { type: 'noul', instructions: 'x' } };
const SCORE = { rel: { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c'] } };
const scoreAns = (o = {}) => ({ rel: { type: 'score', score: 1.27, confidence: 0.58, probabilities: { 0: 0.01, 1: 0.72, 2: 0.27 }, ...o } });

test('noul: p in 0..1 accepted (shape seen on jev-1.14.0)', async () => {
  const r = await call(NOUL, { same: { type: 'noul', noul: 0.63 } });
  assert.equal(r.answers.same.noul, 0.63);
});
test('noul: missing, out of range or non-number rejected', async () => {
  for (const v of [undefined, -0.1, 1.2, '0.5', NaN]) await rejects(call(NOUL, { same: { type: 'noul', noul: v } }), 'noul same');
});
test('score: list criteria, index-keyed probabilities accepted', async () => {
  const r = await call(SCORE, scoreAns());
  assert.equal(r.answers.rel.score, 1.27);
});
test('score: wrong keys, bad sum, score out of range, missing confidence rejected', async () => {
  await rejects(call(SCORE, scoreAns({ probabilities: { a: 0.01, b: 0.72, c: 0.27 } })), 'keys rel');
  await rejects(call(SCORE, scoreAns({ probabilities: { 0: 0.5, 1: 0.72, 2: 0.27 } })), 'sum rel');
  await rejects(call(SCORE, scoreAns({ score: 2.5 })), 'score rel');
  await rejects(call(SCORE, scoreAns({ confidence: null })), 'confidence rel');
});
test('choice still validated as before', async () => {
  const Q = { m: { type: 'choice', instructions: 'x', criteria: { a: 'a', b: 'b' } } };
  await call(Q, { m: { choice: 'a', confidence: 0.4, probabilities: { a: 0.7, b: 0.3 } } });
  await rejects(call(Q, { m: { choice: 'b', confidence: 0.4, probabilities: { a: 0.7, b: 0.3 } } }), 'choice m');
});
test('object state is English-checked as JSON text', async () => {
  await call(NOUL, { same: { type: 'noul', noul: 0.5 } }, { task_a: 'Rename a file.', task_b: 'Rename a file again.' });
  await assert.rejects(call(NOUL, { same: { type: 'noul', noul: 0.5 } }, { task_a: '파일 이름을 바꾼다', task_b: '같은 작업' }), (e) => e.reason === 'non_english');
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
if (failed) process.exit(1);
