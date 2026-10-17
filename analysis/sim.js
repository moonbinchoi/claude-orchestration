// Replay past main sessions under: actual, A (current structure improved), B (OMC-style executor + domain review).
const fs = require('fs'), path = require('path');
const root = path.join(require('os').homedir(), '.claude', 'projects');
const M = 1e-6;
const P = { // in, out, cw5m, cw1h, read (USD/MTok, platform.claude.com pricing 2026-10-17)
  'claude-opus-5-5': [4, 20, 5, 8, 0.2], 'claude-opus-5': [5, 25, 6.25, 10, 0.5],
  'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.1], 'claude-sonnet-5': [2, 10, 2.5, 4, 0.1], // sonnet-5 unlisted: priced as 5.5
  'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.2, 0.01], 'claude-haiku-4-5-20251001': [1, 5, 1.25, 2, 0.1],
};
const CPT = 1.69; // chars per token, measured from context deltas
const BUDGET = 10000;
const DIRECT = new Set(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch']);
const EDIT = new Set(['Edit', 'Write', 'NotebookEdit']);
const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const clen = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, b) => a + (typeof b.text === 'string' ? b.text.length : b.type === 'image' || b.type === 'document' ? 3000 : 0), 0) : 0);
const price = (m) => P[m] || P['claude-opus-5-5'];
const usageCost = (u, m) => {
  const p = price(m), cc = u.cache_creation || {};
  const c1 = cc.ephemeral_1h_input_tokens || 0;
  const c5 = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - c1);
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + c5 * p[2] + c1 * p[3] + (u.cache_read_input_tokens || 0) * p[4]) * M;
};
// a subagent run replayed from a sequence of [resultTok, outTok] steps
const runCost = (steps, fixed, p, X) => {
  const seq = []; let acc = 0;
  for (const s of steps) { acc += X; while (acc >= 1) { seq.push(s); acc -= 1; } }
  if (!seq.length && steps.length) seq.push(steps[0]);
  let ctx = fixed, cost = fixed * p[3] * M, pending = 0;
  for (const [r, o] of seq) { cost += (ctx * p[4] + pending * p[3] + o * p[1]) * M; ctx += pending; pending = r + o; }
  return cost + (ctx * p[4] + pending * p[3] + 500 * p[1]) * M; // final summary turn
};

const sessions = [];
for (const proj of fs.readdirSync(root)) {
  if (proj.includes('scratchpad')) continue;
  const pd = path.join(root, proj);
  if (!fs.statSync(pd).isDirectory()) continue;
  for (const f of fs.readdirSync(pd).filter((x) => x.endsWith('.jsonl'))) {
    const sid = f.replace('.jsonl', '');
    const es = rd(path.join(pd, f)).filter((e) => !e.isSidechain);
    const res = {}; const calls = []; const byId = {}; let human = false;
    for (const e of es) {
      if (e.type === 'user' && e.message) {
        const c = e.message.content;
        if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) { for (const b of c) if (b.type === 'tool_result') res[b.tool_use_id] = clen(b.content); }
        else if (!e.isMeta) human = true;
      }
      if (e.type === 'assistant' && e.message && e.message.usage) {
        let m = byId[e.message.id];
        if (!m) {
          const u = e.message.usage;
          m = byId[e.message.id] = { model: e.message.model, cost: usageCost(u, e.message.model), ctx: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0, uses: [], human };
          calls.push(m); human = false;
        }
        for (const b of e.message.content || []) if (b.type === 'tool_use') m.uses.push(b);
      }
    }
    // subagent runs of this session
    const subs = [];
    const sd = path.join(pd, sid, 'subagents');
    if (fs.existsSync(sd)) for (const sf of fs.readdirSync(sd).filter((x) => x.endsWith('.jsonl'))) {
      let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(sd, sf.replace('.jsonl', '.meta.json')), 'utf8')); } catch (e) {}
      const seen = new Set(); let cost = 0;
      for (const e of rd(path.join(sd, sf))) if (e.type === 'assistant' && e.message && e.message.usage && !seen.has(e.message.id)) { seen.add(e.message.id); cost += usageCost(e.message.usage, e.message.model); }
      subs.push({ type: meta.agentType, cost });
    }
    if (calls.length) sessions.push({ calls, res, subs });
  }
}

let WC = 0;
function simulate(scheme, X, review, BRIEF = 600, RERUN = 0, FRAC = 1) {
  let total = 0, delegations = 0;
  for (const { calls, res, subs } of sessions) {
    const op = price('claude-opus-5-5');
    // subagent costs: A replaces editor runs with ~2 main edit calls; B keeps them
    for (const s of subs) {
      if (scheme === 'A' && s.type === 'editor') total += 2 * (121000 * op[4] + 300 * op[1]) * M;
      else total += s.cost;
    }
    if (scheme === 'actual') { for (const c of calls) total += c.cost; continue; }
    // windows between human prompts
    const wins = []; let w = null;
    calls.forEach((c, i) => { if (c.human || !w) { w = []; wins.push(w); } w.push(i); });
    let delta = 0; // tokens removed from main context so far (reset on compaction)
    let prevCtx = 0;
    const keep = (c) => { const p = price(c.model); total += Math.max(0, c.cost - delta * p[4] * M); };
    for (const win of wins) {
      const first = calls[win[0]];
      if (first.ctx < prevCtx * 0.7) delta = 0; // compaction or clear
      const stepOf = (c) => [c.uses.filter((u) => DIRECT.has(u.name)).reduce((a, u) => a + (res[u.id] || 0), 0) / CPT, c.out];
      const isDirect = (c) => c.uses.some((u) => DIRECT.has(u.name));
      const directIdx = win.filter((i) => isDirect(calls[i]));
      const winChars = directIdx.reduce((a, i) => a + calls[i].uses.reduce((b, u) => b + (res[u.id] || 0), 0), 0);
      let removed = new Set(), steps = [];
      if (scheme === 'B' && (directIdx.length > 2 || winChars > 3000) && ((WC++ * 37) % 100) < FRAC * 100) {
        removed = new Set(directIdx);
        steps = directIdx.map((i) => stepOf(calls[i]));
        total += (1 + RERUN) * (runCost(steps, 12000, price("claude-sonnet-5-5"), X) + review);
      }
      if (scheme === 'A') {
        let acc = 0, crossed = false;
        for (const i of directIdx) {
          const c = calls[i];
          const onlyEdits = c.uses.filter((u) => DIRECT.has(u.name)).every((u) => EDIT.has(u.name));
          if (crossed && !onlyEdits) { removed.add(i); steps.push(stepOf(c)); }
          if (!onlyEdits) acc += c.uses.reduce((b, u) => b + (res[u.id] || 0), 0);
          if (acc >= BUDGET) crossed = true;
        }
        if (steps.length) {
          const n = Math.max(1, Math.ceil(steps.reduce((a, s) => a + s[0] * CPT, 0) / BUDGET));
          for (let k = 0; k < n; k++) total += runCost(steps.slice(Math.floor(k * steps.length / n), Math.floor((k + 1) * steps.length / n)), 7800, price('claude-haiku-5-5'), X);
          total += n * ((first.ctx - delta) * op[4] + 100 * op[1]) * M; // denied call round trips
        }
      }
      // replay the window's main calls
      let removedTok = 0, replaced = false;
      for (const i of win) {
        const c = calls[i];
        if (removed.has(i)) { removedTok += stepOf(c)[0] + c.out; continue; }
        if (removedTok && !replaced) { // dispatch + receive calls replace the removed run
          const n = scheme === 'A' ? Math.max(1, Math.ceil(removedTok * CPT / BUDGET)) : 1;
          total += n * 2 * ((c.ctx - delta) * op[4] + BRIEF * op[1] + 1100 * op[3]) * M;
          delegations += n; replaced = true;
          delta += Math.max(0, removedTok - 1100 * n);
        }
        keep(c);
      }
      if (removedTok && !replaced) { total += 2 * ((first.ctx - delta) * op[4] + BRIEF * op[1] + 1100 * op[3]) * M; delegations++; delta += Math.max(0, removedTok - 1100); }
      prevCtx = calls[win[win.length - 1]].ctx;
    }
  }
  return { total, delegations };
}

const base = simulate('actual', 1, 0).total;
console.log(`sessions ${sessions.length}; actual total (main + subagents) $${base.toFixed(2)}`);
for (const X of [1, 1.5, 2]) {
  const a = simulate('A', X, 0);
  console.log(`A  X=${X}: $${a.total.toFixed(2)} (${(100 * (a.total - base) / base).toFixed(0)}%), delegations ${a.delegations}`);
  for (const r of [0.06, 0.24]) {
    const b = simulate('B', X, r);
    console.log(`B  X=${X} review $${r}: $${b.total.toFixed(2)} (${(100 * (b.total - base) / base).toFixed(0)}%), delegations ${b.delegations}`);
  }
}
// breakdown and sensitivity
let mainC = 0, subC = 0, subBy = {};
for (const s of sessions) { for (const c of s.calls) mainC += c.cost; for (const x of s.subs) { subC += x.cost; subBy[x.type] = (subBy[x.type] || 0) + x.cost; } }
console.log(`\nactual: main $${mainC.toFixed(2)}, subagents $${subC.toFixed(2)} ${JSON.stringify(Object.fromEntries(Object.entries(subBy).map(([k, v]) => [k, +v.toFixed(2)])))}`);
for (const [brief, rerun] of [[2000, 0], [600, 0.3], [2000, 0.3]]) {
  const a = simulate('A', 1.5, 0, brief, 0), b = simulate('B', 1.5, 0.06, brief, rerun);
  console.log(`brief ${brief} tok, executor rerun ${rerun * 100}%: A ${(100 * (a.total - base) / base).toFixed(0)}%  B ${(100 * (b.total - base) / base).toFixed(0)}%`);
}
console.log('\nB with only a fraction of non-trivial windows delegable (rest stay in main as today), X=1.5, review $0.06, brief 2000, rerun 30%:');
for (const f of [0.3, 0.4, 0.5, 0.6, 0.8]) { const b = simulate('B', 1.5, 0.06, 2000, 0.3, f); console.log(`  ${f * 100}%: B ${(100 * (b.total - base) / base).toFixed(0)}%`); }
