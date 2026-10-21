import assert from 'node:assert/strict';
import { extractClaims } from './report-claims.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const types = (r, o) => extractClaims(r, { random: () => 1, ...o }).claims.map((c) => c.type);

test('test_pass with count; failing or negated sentences are not claims', () => {
  const { claims } = extractClaims('DONE\nAll 24 tests pass. Lint clean.', { random: () => 1 });
  assert.deepEqual(claims.map((c) => [c.type, c.count]), [['test_pass', 24], ['test_pass', undefined]]);
  assert.deepEqual(types('DONE\nTests did not pass. 2 tests fail.'), []);
  assert.deepEqual(types('DONE\nAll tests pass with 0 failures.'), ['test_pass']);
});
test('file_change: verb then file; urls, citations and negations excluded', () => {
  const c = extractClaims('DONE\nCreated report-check.mjs and edited agent-hooks.mjs.', { random: () => 1 }).claims[0];
  assert.deepEqual([c.type, c.files], ['file_change', ['report-check.mjs', 'agent-hooks.mjs']]);
  assert.deepEqual(types('DONE\nSee https://x.dev/CHANGELOG.md for the fix.'), []);
  assert.deepEqual(types('DONE\nThe fix is described in notes.md:28-41.'), []);
  assert.deepEqual(types('DONE\nDid not edit settings.json.'), []);
});
test('file_change: suggestions, third-party work and library names are not own changes', () => {
  assert.deepEqual(types('DONE\nSuggested fix: add a test to x.test.mjs.'), []);
  assert.deepEqual(types('DONE\nYou should update config.json next. Consider editing a.mjs.'), []);
  assert.deepEqual(types('DONE\nThe implementer added a guard in y.mjs.'), []);
  for (const lib of ['Node.js', 'Next.js', 'Vue.js', 'Nuxt.js', 'Express.js', 'React.js', 'D3.js', 'Three.js', 'node.JS']) assert.deepEqual(types(`DONE\nUpdated the ${lib} version.`), [], lib);
  const c = extractClaims('DONE\nUpdated Node.js usage in a.mjs.', { random: () => 1 }).claims[0];
  assert.deepEqual([c.type, c.files], ['file_change', ['a.mjs']]);
});
test('text between two single-token backtick spans is not dropped as a quote', () => {
  assert.deepEqual(types('DONE\nI read `a/b/` plus helpers. All 16 test files pass. I ran (`p.mjs`, `q.mjs`).'), ['test_pass']);
  assert.deepEqual(types('DONE\nThe brief said `all tests pass` here.'), []);
});
test('file_change: skipped entirely for a reviewer', () => {
  assert.deepEqual(types('DONE\nCreated new-thing.mjs.', { agentType: 'reviewer' }), []);
  assert.deepEqual(types('DONE\nChanged files:\n- one.mjs', { agentType: 'reviewer' }), []);
  assert.deepEqual(types('DONE\nCreated new-thing.mjs.', { agentType: 'worker' }), ['file_change']);
});
test('test_pass count: the number next to the pass verb; several candidates -> ambiguous, no count', () => {
  const one = (r) => extractClaims(r, { random: () => 1 }).claims[0];
  assert.equal(one('DONE\nAdded 4 new tests; all 52 tests pass.').count, 52);
  assert.equal(one('DONE\nTests pass: 52 passed, 3 files changed.').count, 52);
  assert.equal(one('DONE\nRan 52 tests, all green.').count, 52);
  const m = one('DONE\n3 tests pass and 4 specs pass.');
  assert.deepEqual([m.count, m.ambiguous], [undefined, true]);
  const n = one('DONE\nAdded 4 tests and 5 specs; the suite passes.');
  assert.deepEqual([n.count, n.ambiguous], [undefined, true]);
});
test('files list under a heading: each bullet is a file_change', () => {
  const c = extractClaims('DONE\nChanged or created files:\n- C:/a/b/one.mjs\n- two.test.mjs\n\nNothing else here.', { random: () => 1 }).claims;
  assert.deepEqual(c.map((x) => x.files), [['one.mjs'], ['two.test.mjs']]);
});
test('source, verified, all_done', () => {
  const s = extractClaims('DONE\nI read https://docs.example.com/x and confirmed the limit. Checked the output. All items were processed.', { random: () => 1 }).claims;
  assert.deepEqual(s.map((c) => c.type), ['source', 'verified', 'all_done']);
  assert.equal(s[0].url, 'https://docs.example.com/x');
});
test('code fences skipped; status-only first line is not a sentence', () => {
  assert.deepEqual(types('DONE\n```\nAll 3 tests pass.\n```'), []);
});
test('unextracted English sentences are sampled by the injected random; Korean never', () => {
  const r = 'DONE\nThe weather was calm today.\n오늘은 날씨가 맑고 하늘이 높습니다.';
  assert.deepEqual(extractClaims(r, { random: () => 0 }).sample, ['The weather was calm today.']);
  assert.deepEqual(extractClaims(r, { random: () => 0.5 }).sample, []);
});

test('quoted text, citations and findings are not the agent claims', () => {
  assert.deepEqual(types('DONE\nThe old code said "All tests pass." and `all items are done` was wrong.'), []);
  assert.deepEqual(types('DONE\nThe old report said “All tests pass” here.'), []);
  assert.deepEqual(types('DONE\nclaim-rules.mjs:42 says all items are complete.'), []);
  assert.deepEqual(types('DONE\nLine 12: all items done.'), []);
  assert.deepEqual(types('DONE\n- Issue: all items are complete here.\n  All tests pass in the draft.\n\nAll 5 tests pass.'), ['test_pass']);
  assert.deepEqual(types('DONE\nCreated `a.mjs`.'), ['file_change']);
});
test('verified: words inside paths do not trigger; researcher has no verified type', () => {
  assert.deepEqual(types('DONE\nResults are in D:/x/verify/result.md now.'), []);
  assert.deepEqual(types('DONE\nI verified the output.'), ['verified']);
  assert.deepEqual(types('DONE\nI verified the output.', { agentType: 'researcher' }), []);
});
test('Files changed: block gives one file_change per bullet (its first path) until a blank line or heading', () => {
  const r = 'DONE\nFiles changed:\n- src/a.mjs\n- `src/b.mjs`: new helper\n  c.mjs and d.mjs\n- g.mjs: renamed from old.mjs\n## Notes\nThe notes.mjs stays.\n\nFiles changed:\n- e.mjs\n\n- f.mjs';
  const { claims } = extractClaims(r, { random: () => 1 });
  assert.deepEqual(claims.map((c) => [c.type, c.files]), [['file_change', ['a.mjs']], ['file_change', ['b.mjs']], ['file_change', ['g.mjs']], ['file_change', ['e.mjs']]]);
  assert.deepEqual(types('DONE\nFiles changed:\n- a.mjs', { agentType: 'reviewer' }), []);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
