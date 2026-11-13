import assert from 'node:assert/strict';
import { checkRequest } from './ask-check.mjs';

process.env.TYPESAFE_API_KEY = 'test-key-not-real';

const clone = (o) => JSON.parse(JSON.stringify(o));
const OK = { items: [{
  id: 'pr_1',
  state: { word_count: 412, audience: 'reviewers', draft_is_final: false },
  questions: {
    length: { type: 'choice', instructions: 'Pick whether the description should be kept or shortened.', criteria: { keep: 'The description is already short enough for reviewers.', shorten: 'The description has details that reviewers do not need.' } },
    sev: { type: 'score', instructions: 'Rate how severe the problem is.', criteria: ['Not a problem at all.', 'A small problem that can wait.', 'A serious problem that needs a fix now.'] },
    length_fits: { type: 'noul', instructions: 'One of the options keep or shorten fits this case.' },
  },
  companions: { length_fits: 'length' },
}] };
const mut = (fn) => { const o = clone(OK); fn(o.items[0], o); return o; };
const str = (o) => JSON.stringify(o);
const bad = (name, input, rule, where) => test(name, () => {
  const r = checkRequest(typeof input === 'string' ? input : str(input));
  assert.equal(r.ok, false, 'expected rejection');
  assert.equal(r.rule, rule);
  assert.equal(r.where, where);
});

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('OK', () => {
  const r = checkRequest(str(OK));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 'pr_1');
  assert.deepEqual(r.items[0].companions, { length_fits: 'length' });
});
test('companions default to {}', () => {
  const r = checkRequest(str(mut((i) => { delete i.companions; })));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items[0].companions, {});
});
test('bom accepted', () => assert.equal(checkRequest('\uFEFF' + str(OK)).ok, true));
test('numbers skip content check', () => assert.equal(checkRequest(str(mut((i) => { i.state.audience = 12345; }))).ok, true));

test('object criteria description accepted', () => {
  const r = clone(OK); r.items[0].questions.length.criteria.keep = { covers: 'Short enough for reviewers.', does_not_cover: 'Details that reviewers do not need.' };
  assert.equal(checkRequest(JSON.stringify(r)).ok, true);
  const n = clone(OK); n.items[0].questions.length_fits.criteria = { true: { covers: 'One option fits.' }, false: 'No option fits.' };
  assert.equal(checkRequest(JSON.stringify(n)).ok, true);
});
test('object criteria: bad shapes rejected', () => {
  for (const bad of [{}, { Covers: 'x' }, { covers: '' }, { covers: 3 }, { covers: { deep: 'x' } }, Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, 'x.']))]) {
    const r = clone(OK); r.items[0].questions.length.criteria.keep = bad;
    assert.equal(checkRequest(JSON.stringify(r)).rule, 'bad_criteria');
  }
});
test('content rules reach strings inside object criteria', () => {
  const r = clone(OK); r.items[0].questions.sev.criteria[1] = { covers: 'See C:\\Users\\me\\a.txt for it.' };
  const out = checkRequest(JSON.stringify(r));
  assert.equal(out.ok, false); assert.equal(out.where, 'pr_1.questions.sev.criteria.1.covers');
});
test('string-only request gives the same result as before', () => {
  assert.deepEqual(checkRequest(JSON.stringify(OK)), { ok: true, items: OK.items.map((it) => ({ ...it, companions: it.companions ?? {} })) });
});

bad('too large',' '.repeat(32769), 'file_too_large', null);
bad('not json', '{', 'not_json', null);
bad('no items', {}, 'bad_shape', null);
bad('11 items', { items: Array.from({ length: 11 }, (_, n) => ({ ...clone(OK.items[0]), id: `pr_${n}` })) }, 'too_many_items', null);
bad('duplicate item', { items: [clone(OK.items[0]), clone(OK.items[0])] }, 'duplicate_item', null);
bad('bad item id', mut((i) => { i.id = 'PR-1'; }), 'bad_id', null);
bad('proto key rejected', str(OK).replace('"word_count"', '"__proto__"'), 'bad_id', null);
bad('21 fields', mut((i) => { i.state = Object.fromEntries(Array.from({ length: 21 }, (_, n) => [`f${n}`, 'x'])); }), 'too_many_fields', null);
bad('11 questions', mut((i) => { i.questions = Object.fromEntries(Array.from({ length: 11 }, (_, n) => [`q${n}`, { type: 'noul', instructions: 'It is true.' }])); i.companions = {}; }), 'too_many_questions', null);
bad('nested value', mut((i) => { i.state.audience = { a: 1 }; }), 'bad_value', null);
bad('infinite number rejected', str(OK).replace('412', '1e400'), 'bad_value', null);
bad('bad type', mut((i) => { i.questions.length.type = 'box'; }), 'bad_shape', null);
bad('one option', mut((i) => { i.questions.length.criteria = { keep: 'Keep it.' }; }), 'bad_criteria', null);
bad('score not list', mut((i) => { i.questions.sev.criteria = { a: 'one', b: 'two' }; }), 'bad_criteria', null);
bad('noul bad criteria', mut((i) => { i.questions.length_fits.criteria = { yes: 'It fits.', no: 'It does not fit.' }; }), 'bad_criteria', null);
bad('companion not noul', mut((i) => { i.companions = { length: 'sev' }; }), 'bad_companion', null);
bad('companion to noul', mut((i) => { i.companions = { length_fits: 'length_fits' }; }), 'bad_companion', null);
bad('extra question key', mut((i) => { i.questions.length.note = 'C:/x'; }), 'bad_shape', null);
bad('cjk',mut((i) => { i.state.audience = '짧게 bla'; }), 'cjk', 'pr_1.state.audience');
bad('guard', mut((i) => { i.questions.length.instructions = 'a'.repeat(401); }), 'too_long', 'pr_1.questions.length.instructions');
bad('path', mut((i) => { i.questions.length.criteria.keep = 'see src/a.js'; }), 'path_url_email', 'pr_1.questions.length.criteria.keep');
bad('guard path', mut((i) => { i.questions.length.criteria.keep = 'see /usr/a.js'; }), 'posix_path', 'pr_1.questions.length.criteria.keep');
bad('email', mut((i) => { i.state.audience = 'mail a@b.co'; }), 'path_url_email', 'pr_1.state.audience');
bad('redactable', mut((i) => { i.state.audience = 'build 12345 failed'; }), 'redactable', 'pr_1.state.audience');
bad('score location', mut((i) => { i.questions.sev.criteria[1] = '짧게'; }), 'cjk', 'pr_1.questions.sev.criteria.1');
bad('noul criteria location', mut((i) => { i.questions.length_fits.criteria = { true: 'It fits.', false: 'see src/a.js' }; }), 'path_url_email', 'pr_1.questions.length_fits.criteria.false');
bad('format before content', { items: [mut((i) => { i.state.audience = '짧게'; }).items[0], { ...clone(OK.items[0]), id: 'pr_2', state: { a: null } }] }, 'bad_value', null);

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
