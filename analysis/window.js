// Windows = direct calls between resets (human prompt, Agent/SendMessage). Compare count>8 vs chars>T.
const fs = require('fs'), path = require('path');
const root = path.join(require('os').homedir(), '.claude', 'projects');
const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const clen = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, b) => a + (typeof b.text === 'string' ? b.text.length : 0), 0) : 0);
const DIRECT = new Set(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch']);
const wins = [];
for (const proj of fs.readdirSync(root)) {
  if (proj.includes('scratchpad')) continue;
  const pd = path.join(root, proj);
  if (!fs.statSync(pd).isDirectory()) continue;
  for (const f of fs.readdirSync(pd).filter((x) => x.endsWith('.jsonl'))) {
    const es = rd(path.join(pd, f)).filter((e) => !e.isSidechain);
    const res = {};
    for (const e of es) if (e.type === 'user' && Array.isArray(e.message && e.message.content)) for (const b of e.message.content) if (b.type === 'tool_result') res[b.tool_use_id] = clen(b.content);
    let w = { n: 0, chars: 0, maxAt8: 0 };
    const flush = () => { if (w.n) wins.push(w); w = { n: 0, chars: 0 }; };
    for (const e of es) {
      if (e.type === 'user' && e.message && !e.isMeta) {
        const c = e.message.content;
        if (!(Array.isArray(c) && c.some((b) => b.type === 'tool_result'))) flush();
      }
      if (e.type !== 'assistant' || !e.message) continue;
      for (const b of e.message.content || []) {
        if (b.type !== 'tool_use') continue;
        if (b.name === 'Agent' || b.name === 'SendMessage') { flush(); continue; }
        if (!DIRECT.has(b.name)) continue;
        w.n++; w.chars += JSON.stringify(b.input || {}).length + (res[b.id] || 0);
        if (w.n === 8) w.at8 = w.chars;
      }
    }
    flush();
  }
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };
console.log(`windows: ${wins.length}; count>8: ${wins.filter((w) => w.n > 8).length}`);
console.log(`chars at the 8th call (windows reaching 8): p25 ${q(wins.filter((w) => w.at8).map((w) => w.at8), .25)} p50 ${q(wins.filter((w) => w.at8).map((w) => w.at8), .5)} p75 ${q(wins.filter((w) => w.at8).map((w) => w.at8), .75)}`);
console.log(`chars per window: p50 ${q(wins.map((w) => w.chars), .5)} p90 ${q(wins.map((w) => w.chars), .9)}`);
console.log('T | windows over T | over T but count<=8 | count>8 but under T');
for (const T of [5000, 8000, 10000, 15000, 20000, 30000]) {
  const over = wins.filter((w) => w.chars > T);
  console.log(`${T} | ${over.length} | ${over.filter((w) => w.n <= 8).length} | ${wins.filter((w) => w.n > 8 && w.chars <= T).length}`);
}
