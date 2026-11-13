import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFacts } from './query-facts.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'qf-test-'));
const FM = (d) => `---\nname: reviewer\ndescription: ${d}\nmodel: opus\n---\nbody`;

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('type and description', () => {
  const dir = tmp(); writeFileSync(join(dir, 'reviewer.md'), FM('Reviews an artifact against given criteria.'));
  assert.deepEqual(computeFacts({ agentType: 'reviewer', agentsDir: dir }), { agent: { type: 'reviewer', description: 'Reviews an artifact against given criteria.' } });
});
test('CRLF file and a description line in the body only', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'crlf.md'), FM('Finds files.').replace(/\n/g, '\r\n'));
  writeFileSync(join(dir, 'body.md'), '---\nname: body\n---\ndescription: Not in the frontmatter.');
  assert.deepEqual(computeFacts({ agentType: 'crlf', agentsDir: dir }), { agent: { type: 'crlf', description: 'Finds files.' } });
  assert.deepEqual(computeFacts({ agentType: 'body', agentsDir: dir }), { agent: { type: 'body' } });
});
test('no file, long, or guarded description: type only', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'a.md'), FM('x'.repeat(401)));
  writeFileSync(join(dir, 'b.md'), FM('Reads C:\\Users\\me\\notes first.'));
  for (const t of ['none', 'a', 'b']) assert.deepEqual(computeFacts({ agentType: t, agentsDir: dir }), { agent: { type: t } });
  assert.deepEqual(computeFacts({ agentType: 'plugin:skill-x', agentsDir: dir }), { agent: { type: 'plugin:skill-x' } });
});
test('bad type: no agent fact, no file read', () => {
  const dir = tmp(); writeFileSync(join(dir, 'x.md'), FM('ok'));
  for (const t of ['../x', 'a.b', '', 'a b', 5, undefined]) assert.deepEqual(computeFacts({ agentType: t, agentsDir: join(dir, 'sub') }), {});
});
test('scope paths counted inside the Scope section only', () => {
  const brief = 'Summary: s\n## Context\nsee src/a.mjs\n## Scope\nEdit jev/x.mjs and jev\\y.mjs; leave docs alone.\n## Return\nwrite to out/r.md';
  assert.deepEqual(computeFacts({ brief }), { scope_paths: 2 });
  assert.deepEqual(computeFacts({ brief: 'summary: s ## scope edit jev/x.mjs ## return out/r.md' }), { scope_paths: 1 });
  assert.deepEqual(computeFacts({ brief: '**Scope**: nothing to edit\n**Return**: a/b' }), { scope_paths: 0 });
  assert.deepEqual(computeFacts({ brief: 'Summary: no sections here a/b' }), {});
});
test('agent and scope together; no arguments', () => {
  assert.deepEqual(computeFacts({ agentType: 'worker', brief: 'Scope: a/b and c/d', agentsDir: tmp() }), { agent: { type: 'worker' }, scope_paths: 2 });
  assert.deepEqual(computeFacts({}), {});
  assert.deepEqual(computeFacts(), {});
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
