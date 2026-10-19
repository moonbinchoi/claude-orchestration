// report-guard-calibrate: run the report check on saved transcripts and write the records to a file (not the live log).
// stdin: JSON [{ agent_type, transcript_path }]. Usage: node report-guard-calibrate.mjs --out <file> [--no-jev]
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readReport } from './subagent-report.mjs';
import { readTail } from './transcript-read.mjs';
import { checkReport } from './report-check.mjs';
import { loadConfig } from './guard-common.mjs';

export async function calibrate(items, { out, noJev = false, fetchImpl = fetch, random = Math.random, dir = join(homedir(), '.claude', 'jev') } = {}) {
  const { alias } = loadConfig(dir, 'reportGuard', ['log', 'enforce', 'off']);
  const recs = [];
  for (const it of items) {
    const input = { session_id: null, agent_id: null, agent_type: it.agent_type ?? null, agent_transcript_path: it.transcript_path, last_assistant_message: '' };
    let transcript = null;
    try { transcript = readTail(it.transcript_path); } catch { /* unreadable: logged as no_transcript */ }
    const { text, status } = readReport(input, () => transcript?.text ?? '');
    const rec = { ...(await checkReport(input, { text, status, transcript, alias, fetchImpl, random, noJev })), transcript_path: it.transcript_path };
    recs.push(rec);
    if (out) appendFileSync(out, JSON.stringify(rec) + '\n');
  }
  return recs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const out = args[args.indexOf('--out') + 1];
  if (!args.includes('--out') || !out) { console.error('usage: --out <file> [--no-jev]'); process.exit(2); }
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const recs = await calibrate(JSON.parse(raw), { out, noJev: args.includes('--no-jev') });
  console.log(`${recs.length} records -> ${out}`);
}
