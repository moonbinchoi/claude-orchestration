import assert from 'node:assert/strict';
import { assertiveSentences } from './report-sentences.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('picks assertive sentences only, skips status line, fences, quotes and citations', () => {
  const r = assertiveSentences('DONE\nI read the docs. All 12 tests pass. The sky is blue today.\n```\nAll code is fenced here.\n```\nThe doc said "never do this always" literally.\nsrc.mjs:12 never checked here.\n- Nothing was verified for the second file.');
  assert.deepEqual(r, { sentences: ['All 12 tests pass.', 'Nothing was verified for the second file.'], dropped: 0 });
});
test('a failing sentence is dropped and counted, the rest stay; at most 5 are kept', () => {
  const r = assertiveSentences('DONE\nEvery file was checked 통과 done.\nAll of it passes.\n' + Array.from({ length: 7 }, (_, i) => `Item ${i} was fully done.`).join(' '));
  assert.equal(r.dropped, 1);
  assert.equal(r.sentences.length, 5);
  assert.equal(r.sentences[0], 'All of it passes.');
});
test('paths in a sentence are redacted before the checks', () => {
  assert.deepEqual(assertiveSentences('DONE\nNothing changed in C:/Users/x/a.mjs at all.').sentences, ['Nothing changed in <path> at all.']);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
