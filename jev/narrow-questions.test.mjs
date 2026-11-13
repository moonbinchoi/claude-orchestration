import assert from 'node:assert/strict';
import { ROUTER_NARROW, MAIN_NARROW, combine } from './narrow-questions.mjs';
import { INSTRUCTIONS } from './jev-tier.mjs';
import { ROLE } from './main-pick.mjs';

const A = (o) => Object.fromEntries(Object.entries(o).map(([k, p]) => [k, { type: 'noul', noul: p }]));

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('question sets', () => {
  assert.deepEqual(Object.keys(ROUTER_NARROW), ['specified', 'cross_module', 'open_review', 'irreversible']);
  assert.deepEqual(Object.keys(MAIN_NARROW), ['relay_only', 'ambiguous_scope', 'design_decisions', 'many_parts', 'irreversible']);
  for (const q of [...Object.values(ROUTER_NARROW), ...Object.values(MAIN_NARROW)]) { assert.equal(q.type, 'noul'); assert.ok(q.instructions.endsWith(INSTRUCTIONS)); }
  assert.ok(MAIN_NARROW.relay_only.instructions.startsWith(ROLE.trim()));
});
test('question wording is the spec wording', () => {
  assert.equal(ROUTER_NARROW.specified.instructions, 'The brief fixes every step: the work is running commands, exact edits, file operations, or collecting matches into a fixed format.' + INSTRUCTIONS);
  assert.equal(MAIN_NARROW.irreversible.instructions, ROLE.trim() + ' The work includes a risky or irreversible step.' + INSTRUCTIONS);
});
test('combine', () => {
  const base = { specified: 0.9, cross_module: 0.1, open_review: 0.1, irreversible: 0.1 };
  assert.deepEqual(combine(A(base), 'specified'), { model: 'haiku', answers: base, decided_by: ['specified'] });
  assert.equal(combine(A({ ...base, specified: 0.69 }), 'specified').model, 'sonnet');       // uncertain easy answer reads as no
  assert.deepEqual(combine(A({ ...base, specified: 0.69 }), 'specified').decided_by, ['specified']);
  const up = combine(A({ ...base, open_review: 0.31, irreversible: 0.8 }), 'specified');     // uncertain hard answer reads as yes
  assert.equal(up.model, 'opus'); assert.deepEqual(up.decided_by, ['open_review', 'irreversible']);
  assert.equal(combine(A({ ...base, cross_module: 0.30 }), 'specified').model, 'haiku');     // 0.30 itself is not above 0.30
});
test('combine for the main set', () => {
  const base = { relay_only: 0.7, ambiguous_scope: 0.1, design_decisions: 0.1, many_parts: 0.1, irreversible: 0.1 };
  assert.deepEqual(combine(A(base), 'relay_only'), { model: 'haiku', answers: base, decided_by: ['relay_only'] });
  assert.deepEqual(combine(A({ ...base, many_parts: 0.5 }), 'relay_only').decided_by, ['many_parts']);
});
test('a missing answer reads as 0.5', () => {
  const r = combine({ specified: { noul: 0.9 }, cross_module: { noul: 0.1 }, open_review: { noul: 0.1 } }, 'specified');
  assert.equal(r.model, 'opus'); assert.equal(r.answers.irreversible, 0.5); assert.deepEqual(r.decided_by, ['irreversible']);
  assert.deepEqual(combine({}, 'specified').decided_by, ['cross_module', 'open_review', 'irreversible']);
  assert.equal(combine({ ...A({ cross_module: 0.1, open_review: 0.1, irreversible: 0.1 }), specified: { noul: 'yes' } }, 'specified').model, 'sonnet');
});
test('combine takes answers only', () => assert.equal(combine.length, 2));

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
