import assert from 'node:assert/strict';
import { scopeOf } from './claim-scope.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('paragraph only when no heading precedes', () => {
  const r = 'DONE\nAll items done.\nNote one.\n\nItem 3 skipped.';
  assert.equal(scopeOf(r, 'All items done.'), 'DONE\nAll items done.\nNote one.');
});
test('heading section plus paragraph; other sections excluded', () => {
  const r = '## A\nAll items done.\n\nItem 3 skipped.\n\n## B\nOther skipped.';
  const s = scopeOf(r, 'All items done.');
  assert.match(s, /Item 3 skipped/);
  assert.doesNotMatch(s, /Other skipped/);
});
test('markdown marks ignored; unknown claim -> empty', () => {
  assert.match(scopeOf('**All** items `done`.\nx', 'All items done.'), /x/);
  assert.equal(scopeOf('abc', 'zzz'), '');
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
