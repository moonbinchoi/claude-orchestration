import assert from 'node:assert/strict';
import { applyRules } from './claim-rules.mjs';
import { parseTranscript } from './transcript-evidence.mjs';
import { transcript } from './report-fixtures.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const calls = (steps) => parseTranscript(transcript('brief', steps)).calls;
const rules = (claims, steps, o = {}) => applyRules(claims, calls(steps), { status: 'DONE', ...o });
const one = (claim, steps, o) => rules([claim], steps, o).results[0];
const T = { type: 'test_pass', original: 'All 5 tests pass.', count: 5 };
const PASS5 = '# pass 5\n# fail 0';

test('test_pass: no run -> serious; absence under truncation -> cannot_tell', () => {
  assert.equal(one(T, [['Read', { file_path: 'a' }]]).verdict, 'serious');
  assert.equal(one(T, [], { truncated: true }).verdict, 'cannot_tell');
});
test('test_pass: last run failed (is_error or fail count) -> serious; earlier fail then pass -> none', () => {
  assert.equal(one(T, [['Bash', { command: 'node a.test.mjs' }, 'x', true]]).rule, 'last_run_failed');
  assert.equal(one(T, [['Bash', { command: 'node a.test.mjs' }, '# pass 3\n# fail 2']]).rule, 'last_run_failed');
  assert.equal(one(T, [['Bash', { command: 'node a.test.mjs' }, '# pass 3\n# fail 2'], ['Bash', { command: 'node a.test.mjs' }, PASS5]]).verdict, 'none');
});
test('test_pass: claimed count vs output', () => {
  assert.equal(one(T, [['Bash', { command: 'npm test' }, '# pass 7\n# fail 0']]).rule, 'count_mismatch');
  assert.equal(one(T, [['Bash', { command: 'node a.test.mjs' }, '# pass 2'], ['Bash', { command: 'node b.test.mjs' }, '# pass 3']]).verdict, 'none');
  assert.equal(one({ ...T, scoped: true }, [['Bash', { command: 'npm test' }, '# pass 7']]).verdict, 'cannot_tell');
  assert.equal(one(T, [['Bash', { command: 'npm test' }, "test('missing file throws')\nall good"]]).rule, 'no_summary_line');
  const u = one(T, [['Bash', { command: 'npm test' }, "test('x')\nprocess exited with exit code 0"]]);
  assert.deepEqual([u.verdict, u.pair.evidence], ['jev', 'process exited with exit code 0']);
});
test('test_pass: PASS/FAIL line outputs count; run before the last code edit -> minor, md edit ignored', () => {
  const run = ['Bash', { command: 'node a.test.mjs' }, 'PASS a\nPASS b\nPASS c\nPASS d\nPASS e'];
  assert.equal(one(T, [run]).verdict, 'none');
  assert.equal(one(T, [run, ['Edit', { file_path: 'x.mjs' }]]).verdict, 'minor');
  assert.equal(one(T, [run, ['Edit', { file_path: 'x.md' }]]).verdict, 'none');
});
test('test_pass: Node 24 non-TTY reporter lines count', () => {
  assert.equal(one(T, [['Bash', { command: 'node --test' }, 'ℹ tests 5\nℹ pass 5\nℹ fail 0']]).verdict, 'none');
  assert.equal(one(T, [['Bash', { command: 'node --test' }, 'ℹ pass 3\nℹ fail 2']]).rule, 'last_run_failed');
});
test('file_change: Edit/Write/Bash write by basename; none -> serious', () => {
  const c = { type: 'file_change', original: 'Created a.mjs.', files: ['a.mjs'] };
  assert.equal(one(c, [['Write', { file_path: 'C:\\x\\A.mjs' }]]).verdict, 'none');
  assert.equal(one(c, [['Bash', { command: 'cat > /x/a.mjs' }]]).verdict, 'none');
  assert.equal(one(c, [['Bash', { command: 'cat /x/a.mjs' }]]).verdict, 'serious');
  assert.equal(one(c, [['Edit', { file_path: 'b.mjs' }]]).rule, 'no_edit_for_file');
});
test('verified: needs a look after the last edit', () => {
  const c = { type: 'verified', original: 'Verified the output.' };
  assert.equal(one(c, [['Edit', { file_path: 'a.mjs' }], ['Read', { file_path: 'a.mjs' }]]).verdict, 'none');
  assert.equal(one(c, [['Read', { file_path: 'a.mjs' }], ['Edit', { file_path: 'a.mjs' }]]).verdict, 'minor');
  assert.equal(one(c, []).verdict, 'minor');
  // the result file written last (md/txt/json) is not the edit to check after
  assert.equal(one(c, [['Edit', { file_path: 'a.mjs' }], ['Read', { file_path: 'a.mjs' }], ['Write', { file_path: 'r.md' }]]).verdict, 'none');
  assert.equal(one(c, [['Edit', { file_path: 'a.mjs' }], ['Write', { file_path: 'r.json' }]]).verdict, 'minor');
});
test('all_done: skipped line in the same paragraph or heading section -> serious; elsewhere ignored; PARTIAL alone -> minor', () => {
  const c = { type: 'all_done', original: 'All items done.' };
  assert.equal(one(c, [], { report: 'DONE\nAll items done.' }).verdict, 'none');
  assert.equal(one(c, [], { report: 'DONE\nAll items done.\nItem 3 skipped: no access.' }).verdict, 'serious');
  assert.equal(one(c, [], { report: 'DONE\nSkipped: none.' }).verdict, 'none');
  assert.equal(one(c, [], { status: 'PARTIAL', report: 'PARTIAL' }).verdict, 'minor');
  assert.equal(one(c, [], { report: 'DONE\nAll items done.\n\nItem 3 skipped: no access.' }).verdict, 'none');
  assert.equal(one(c, [], { report: '## A\nAll items done.\n\nItem 3 skipped: no access.' }).verdict, 'serious');
  assert.equal(one(c, [], { report: '## A\nAll items done.\n\n## B\nItem 3 skipped: no access.' }).verdict, 'none');
  assert.equal(one(c, [], { status: 'PARTIAL', report: 'PARTIAL\nAll items done.\nItem 3 skipped.' }).verdict, 'serious');
});
test('all_done: skipped words inside citations and findings do not count', () => {
  const c = { type: 'all_done', original: 'All items done.' };
  assert.equal(one(c, [], { report: 'DONE\nAll items done.\nsrc/a.mjs:12 handles incomplete input.' }).verdict, 'none');
  assert.equal(one(c, [], { report: 'DONE\nAll items done.\n- Issue: step 3 not covered.' }).verdict, 'none');
});
test('source: researcher only; WebFetch host must match; no url -> any fetch', () => {
  const one = (c, st) => rules([c], st, { agentType: 'researcher' }).results[0];
  const s = [['WebFetch', { url: 'https://www.docs.example.com/a' }]];
  assert.equal(one({ type: 'source', original: 'x', url: 'https://docs.example.com/b' }, s).verdict, 'none');
  assert.equal(one({ type: 'source', original: 'x', url: 'https://other.dev/b' }, s).verdict, 'serious');
  assert.equal(one({ type: 'source', original: 'x', url: null }, s).verdict, 'none');
  assert.equal(one({ type: 'source', original: 'x', url: null }, []).verdict, 'serious');
  const o = rules([{ type: 'source', original: 'x', url: null }], [], { agentType: 'worker' }).results[0];
  assert.deepEqual([o.verdict, o.rule], ['none', 'not_researcher']);
});
test('DONE with an unresolved last tool error -> jev pair; resolved by a later success -> none', () => {
  const report = 'DONE\nEverything was finished as asked.';
  const err = [['Bash', { command: 'ls' }, 'cannot access: no such file\nmore', true]];
  const r = rules([], err, { report });
  assert.deepEqual(r.doneError.pair, { claim: 'The agent reports the task as DONE.', evidence: 'cannot access: no such file' });
  assert.equal(rules([], [...err, ['Bash', { command: 'ls .' }, 'a b']], { report }).doneError, null);
  assert.equal(rules([], err, { report: 'PARTIAL\nSome work.', status: 'PARTIAL' }).doneError, null);
});
test('run detection uses the leading program: grep/cat of a test file is not a run', () => {
  assert.equal(one(T, [['Bash', { command: 'grep foo a.test.mjs' }, '# pass 5\n# fail 0']]).rule, 'no_test_run');
  assert.equal(one(T, [['Bash', { command: 'cd /x && node a.test.mjs' }, PASS5]]).verdict, 'none');
});
test('failures are counted from summary lines only', () => {
  const run = (out) => one(T, [['Bash', { command: 'node a.test.mjs' }, out]]);
  assert.equal(run('PASS records 2 failed attempts\nok - records 2 failed attempts\n# pass 5\n# fail 0').verdict, 'none');
  assert.equal(run('# pass 3\n# fail 2').rule, 'last_run_failed');
  assert.equal(run('Tests: 2 failed, 3 passed, 5 total').rule, 'last_run_failed');
  assert.equal(run('=== 2 failed, 3 passed in 0.1s ===').rule, 'last_run_failed');
});
test('file_change: stderr and null-sink redirects are not writes; real redirects are', () => {
  const c = { type: 'file_change', original: 'Created a.mjs.', files: ['a.mjs'] };
  for (const cmd of ['cat a.mjs 2>/dev/null', 'cat a.mjs 2>&1', 'cat a.mjs > /dev/null', 'cat a.mjs >/dev/null', 'cat a.mjs >$null', 'cat a.mjs > NUL']) assert.equal(one(c, [['Bash', { command: cmd }]]).verdict, 'serious', cmd);
  assert.equal(one(c, [['Bash', { command: 'echo x > a.mjs' }]]).verdict, 'none');
  assert.equal(one(c, [['Bash', { command: 'echo x >> a.mjs 2>/dev/null' }]]).verdict, 'none');
});
test('test_pass: an ambiguous count claim gets cannot_tell, but a failed run is still serious', () => {
  const a = { ...T, count: undefined, ambiguous: true };
  assert.equal(one(a, [['Bash', { command: 'npm test' }, PASS5]]).rule, 'count_ambiguous');
  assert.equal(one(a, [['Bash', { command: 'npm test' }, '# pass 3\n# fail 2']]).rule, 'last_run_failed');
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
