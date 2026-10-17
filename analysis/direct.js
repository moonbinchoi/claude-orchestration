// Main-session direct tool calls: result size (chars, token delta), carryover, Grep/Glob clusters.
const fs = require('fs');
const path = require('path');
const root = path.join(require('os').homedir(), '.claude', 'projects');
const OUT = process.argv[2];
const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const clen = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, b) => a + (typeof b.text === 'string' ? b.text.length : 0), 0) : 0);
const q = (a, p) => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const DIRECT = new Set(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch']);
const SEARCH = new Set(['Grep', 'Glob']);

const calls = []; // {tool, chars, tok, carry, model}
const clusters = []; // {n, inChars, resChars, resTok, carry, model}
const models = {};
for (const proj of fs.readdirSync(root)) {
  if (proj.includes('scratchpad')) continue; // A/B test sandboxes
  const pd = path.join(root, proj);
  if (!fs.statSync(pd).isDirectory()) continue;
  for (const f of fs.readdirSync(pd).filter((x) => x.endsWith('.jsonl'))) {
    const es = rd(path.join(pd, f)).filter((e) => !e.isSidechain);
    // assistant API calls in order, merged by message.id
    const msgs = []; const byId = {};
    const results = {}; // tool_use_id -> chars
    let humanSince = false;
    for (const e of es) {
      if (e.type === 'assistant' && e.message && e.message.usage) {
        let m = byId[e.message.id];
        if (!m) {
          const u = e.message.usage;
          m = byId[e.message.id] = { ctx: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0, uses: [], model: e.message.model, human: humanSince, prompt: e.promptId };
          msgs.push(m); humanSince = false;
          models[m.model] = (models[m.model] || 0) + 1;
        }
        for (const b of e.message.content || []) if (b.type === 'tool_use') m.uses.push(b);
      } else if (e.type === 'user' && e.message) {
        const c = e.message.content;
        if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) {
          for (const b of c) if (b.type === 'tool_result') results[b.tool_use_id] = clen(b.content);
        } else if (!e.isMeta) humanSince = true;
      }
    }
    // carry: later API calls before the context drops below this point (compaction / clear)
    const carryOf = (i) => { let k = 0; for (let j = i + 1; j < msgs.length; j++) { if (msgs[j].ctx < msgs[i].ctx) break; k++; } return k; };
    let cl = null;
    const flush = () => { if (cl) clusters.push(cl); cl = null; };
    msgs.forEach((m, i) => {
      if (m.human) flush();
      const next = msgs[i + 1];
      const delta = next && !next.human && m.uses.length ? next.ctx - m.ctx - m.out : null;
      const carry = carryOf(i);
      for (const u of m.uses) {
        if (!DIRECT.has(u.name)) { if (u.name !== 'TodoWrite') flush(); continue; }
        const chars = results[u.id] || 0;
        const tok = m.uses.length === 1 && delta > 0 ? delta : null;
        calls.push({ tool: u.name, chars, tok, carry, model: m.model, cmd: u.input && u.input.command ? String(u.input.command).slice(0, 300) : undefined });
        if (SEARCH.has(u.name)) {
          cl = cl || { n: 0, inChars: 0, resChars: 0, resTok: 0, tokKnown: true, carry, model: m.model };
          cl.n++; cl.inChars += JSON.stringify(u.input).length; cl.resChars += chars;
          if (tok == null) cl.tokKnown = false; else cl.resTok += tok;
        } else flush();
      }
    });
    flush();
  }
}

console.log('main models:', JSON.stringify(models));
console.log(`direct calls: ${calls.length}`);
// chars/token ratio from calls where both are known
const both = calls.filter((c) => c.tok && c.chars > 200);
const ratio = q(both.map((c) => c.chars / c.tok), 0.5);
console.log(`chars per token (median, results >200 chars): ${ratio.toFixed ? ratio.toFixed(2) : ratio}`);
console.log('tool | n | resultChars p50 p90 | tokDelta p50 p90 | %>1K tok (est) | carry p50');
const by = {};
for (const c of calls) (by[c.tool] = by[c.tool] || []).push(c);
for (const [t, cs] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  const est = cs.map((c) => (c.tok != null ? c.tok : c.chars / ratio));
  const over = est.filter((x) => x > 1000).length;
  const tk = cs.map((c) => c.tok).filter((x) => x != null);
  console.log([t, cs.length, `${q(cs.map((c) => c.chars), 0.5)} ${q(cs.map((c) => c.chars), 0.9)}`, `${q(tk, 0.5)} ${q(tk, 0.9)}`, `${Math.round((100 * over) / cs.length)}%`, q(cs.map((c) => c.carry), 0.5)].join(' | '));
}
console.log(`Grep/Glob clusters: ${clusters.length}; calls per cluster p50 ${q(clusters.map((c) => c.n), 0.5)} p90 ${q(clusters.map((c) => c.n), 0.9)}; resChars p50 ${q(clusters.map((c) => c.resChars), 0.5)} p90 ${q(clusters.map((c) => c.resChars), 0.9)}; carry p50 ${q(clusters.map((c) => c.carry), 0.5)}`);
fs.writeFileSync(OUT, JSON.stringify({ ratio, clusters, calls }));
