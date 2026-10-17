// Estimate cost of delegating the direct work that happened past a 10,000-char budget.
const fs = require('fs'), path = require('path');
const root = path.join(require('os').homedir(), '.claude', 'projects');
const M = 1e-6;
const PRICE = { // USD/token: in, out, cw5m, cw1h, read (platform.claude.com pricing, fetched 2026-10-17)
  'claude-opus-5-5': [4, 20, 5, 8, 0.2], 'claude-opus-5': [5, 25, 6.25, 10, 0.5],
  'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.1], 'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.2, 0.01],
  'claude-haiku-4-5-20251001': [1, 5, 1.25, 2, 0.1],
};
const T = 10000;
const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const clen = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, b) => a + (typeof b.text === 'string' ? b.text.length : b.type === 'image' || b.type === 'document' ? 3000 : 0), 0) : 0);
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const usageCost = (u, model) => {
  const p = PRICE[model]; if (!p) return null;
  const cc = u.cache_creation || {};
  const c5 = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : (u.cache_creation_input_tokens || 0);
  const c1 = cc.ephemeral_1h_input_tokens || 0;
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + c5 * p[2] + c1 * p[3] + (u.cache_read_input_tokens || 0) * p[4]) * M;
};

// 1) actual subagent run cost and wall time by role|model
const runs = {};
for (const proj of fs.readdirSync(root)) {
  if (proj.includes('scratchpad')) continue;
  const pd = path.join(root, proj);
  if (!fs.statSync(pd).isDirectory()) continue;
  for (const sess of fs.readdirSync(pd)) {
    const sd = path.join(pd, sess, 'subagents');
    if (!fs.existsSync(sd)) continue;
    for (const f of fs.readdirSync(sd).filter((x) => x.endsWith('.jsonl'))) {
      let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(sd, f.replace('.jsonl', '.meta.json')), 'utf8')); } catch (e) {}
      const es = rd(path.join(sd, f)); const seen = new Set(); let cost = 0, model = '', ok = true;
      for (const e of es) {
        if (e.type !== 'assistant' || !e.message || !e.message.usage || seen.has(e.message.id)) continue;
        seen.add(e.message.id); model = e.message.model;
        const c = usageCost(e.message.usage, model); if (c == null) ok = false; else cost += c;
      }
      const ts = es.map((e) => Date.parse(e.timestamp)).filter((x) => x);
      if (!ok || !seen.size) continue;
      const k = `${meta.agentType}|${model}`;
      (runs[k] = runs[k] || []).push({ cost, sec: ts.length ? (Math.max(...ts) - Math.min(...ts)) / 1000 : NaN });
    }
  }
}
console.log('subagent run cost (USD) and wall time (s), by role|model with n>=5:');
for (const [k, rs] of Object.entries(runs).filter(([, r]) => r.length >= 5).sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${k}: n ${rs.length} | cost p50 ${q(rs.map((r) => r.cost), .5).toFixed(4)} p90 ${q(rs.map((r) => r.cost), .9).toFixed(4)} | time p50 ${Math.round(q(rs.map((r) => r.sec), .5))} p90 ${Math.round(q(rs.map((r) => r.sec), .9))}`);

// 2) main windows past T: remainder that would be delegated
const wins = [];
for (const proj of fs.readdirSync(root)) {
  if (proj.includes('scratchpad')) continue;
  const pd = path.join(root, proj);
  if (!fs.statSync(pd).isDirectory()) continue;
  for (const f of fs.readdirSync(pd).filter((x) => x.endsWith('.jsonl'))) {
    const es = rd(path.join(pd, f)).filter((e) => !e.isSidechain);
    const res = {};
    for (const e of es) if (e.type === 'user' && Array.isArray(e.message && e.message.content)) for (const b of e.message.content) if (b.type === 'tool_result') res[b.tool_use_id] = clen(b.content);
    // assistant calls in order for carry
    const ctxs = []; const seen = new Set();
    for (const e of es) if (e.type === 'assistant' && e.message && e.message.usage && !seen.has(e.message.id)) {
      seen.add(e.message.id); const u = e.message.usage;
      ctxs.push((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0));
    }
    const carryAt = (i) => { let k = 0; for (let j = i + 1; j < ctxs.length; j++) { if (ctxs[j] < ctxs[i]) break; k++; } return k; };
    let w = null; let ai = -1; const seen2 = new Set();
    const flush = () => { if (w && w.crossed) wins.push(w); w = null; };
    for (const e of es) {
      if (e.type === 'user' && e.message && !e.isMeta) { const c = e.message.content; if (!(Array.isArray(c) && c.some((b) => b.type === 'tool_result'))) flush(); }
      if (e.type !== 'assistant' || !e.message) continue;
      if (e.message.usage && !seen2.has(e.message.id)) { seen2.add(e.message.id); ai++; }
      for (const b of e.message.content || []) {
        if (b.type !== 'tool_use') continue;
        if (b.name === 'Agent' || b.name === 'SendMessage') { flush(); continue; }
        if (!['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch'].includes(b.name)) continue;
        w = w || { chars: 0, crossed: false, rIn: 0, rOut: 0, rCalls: 0, edits: 0, carry: 0, ctx: 0 };
        const inC = JSON.stringify(b.input || {}).length, outC = res[b.id] || 0;
        if (w.crossed) { w.rIn += inC; w.rOut += outC; w.rCalls++; if (/^(Edit|Write|NotebookEdit)$/.test(b.name)) w.edits++; }
        w.chars += inC + outC;
        if (!w.crossed && w.chars >= T) { w.crossed = true; w.carry = carryAt(Math.max(ai, 0)); w.ctx = ctxs[Math.max(ai, 0)] || 0; }
      }
    }
    flush();
  }
}
const live = wins.filter((w) => w.rCalls > 0);
console.log(`windows crossing ${T}: ${wins.length}; with work after crossing: ${live.length}`);
console.log(`  remainder chars p50 ${q(live.map((w) => w.rIn + w.rOut), .5)} p90 ${q(live.map((w) => w.rIn + w.rOut), .9)}; calls p50 ${q(live.map((w) => w.rCalls), .5)} p90 ${q(live.map((w) => w.rCalls), .9)}; carry p50 ${q(live.map((w) => w.carry), .5)}; main ctx at crossing p50 ${q(live.map((w) => w.ctx), .5)}`);
console.log(`  edit-heavy remainders (>=half calls are Edit/Write): ${live.filter((w) => w.edits * 2 >= w.rCalls).length}`);

// 3) direct vs delegated for the remainder. Main = Opus 5.5, 1h cache. 1.69 chars/token (measured).
const CPT = Number(process.env.CPT || 1.69), O = PRICE['claude-opus-5-5'].map((x) => x * M);
const ctxCost = (tok, carry) => tok * (O[3] + O[4] * carry);
const med = (k, p = .5) => q(runs[k].map((r) => r.cost), p);
const roles = { 'investigator|claude-haiku-5-5': 'investigator haiku-5.5', 'editor|claude-sonnet-5-5': 'editor sonnet-5.5' };
let direct = 0;
for (const w of live) direct += (w.rIn / CPT) * O[1] + ctxCost((w.rIn + w.rOut) / CPT, w.carry);
console.log(`\nremainder done directly in main: total ${direct.toFixed(2)} USD, per window p50 ${q(live.map((w) => (w.rIn / CPT) * O[1] + ctxCost((w.rIn + w.rOut) / CPT, w.carry)), .5).toFixed(4)}`);
for (const [k, label] of Object.entries(roles)) {
  if (!runs[k]) continue;
  for (const p of [.5, .9]) {
    let tot = 0;
    for (const w of live) {
      const n = Math.max(1, Math.ceil((w.rIn + w.rOut) / T)); // one delegation per budget's worth of work
      const deny = w.ctx * O[4] + 100 * O[1];                 // the denied call: one extra main round trip
      const mainSide = n * (600 * O[1] + ctxCost(600 + 500, w.carry)); // brief out + brief/return in context
      tot += deny + mainSide + n * med(k, p);
    }
    console.log(`delegated to ${label} (subagent cost at p${p * 100}): total ${tot.toFixed(2)} USD (${tot < direct ? '-' : '+'}${Math.abs(100 * (tot - direct) / direct).toFixed(0)}% vs direct)`);
  }
}
