import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calibrate } from './report-guard-calibrate.mjs';
import { transcript } from './report-fixtures.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const hb = (m) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'h', name: 'SubagentHandback', input: { message: m } }] } });

test('reads the handback report, writes records to --out only, noJev skips Jev', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-test-'));
  const t = join(dir, 't.jsonl');
  writeFileSync(t, transcript('Do x.', [['Bash', { command: 'ls' }, 'cannot access: no such file', true]]) + hb('DONE\nEverything was finished as asked. All 3 tests pass.') + '\n');
  const out = join(dir, 'out.jsonl');
  const fetchImpl = async () => { throw new Error('must not be called'); };
  const recs = await calibrate([{ agent_type: 'worker', transcript_path: t }, { agent_type: 'worker', transcript_path: join(dir, 'gone.jsonl') }], { out, noJev: true, fetchImpl, dir, random: () => 1 });
  const lines = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual([recs[0].status, recs[0].agent_type, recs[0].jev[0].jev_skipped, recs[0].transcript_path], ['DONE', 'worker', true, t]);
  assert.equal(recs[1].status, 'unknown');
  assert.equal(existsSync(join(dir, 'report-guard.jsonl')), false);
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
