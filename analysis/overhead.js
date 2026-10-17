// Measure subagent overhead from ~/.claude/projects transcripts.
const fs = require('fs');
const path = require('path');
const root = path.join(require('os').homedir(), '.claude', 'projects');
const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const len = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, b) => a + (b.text ? b.text.length : typeof b.content === 'string' ? b.content.length : 0), 0) : 0);
const med = (a) => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

const rows = [];
for (const proj of fs.readdirSync(root)) {
  const pd = path.join(root, proj);
  if (!fs.statSync(pd).isDirectory()) continue;
  for (const sess of fs.readdirSync(pd)) {
    const sd = path.join(pd, sess, 'subagents');
    if (!fs.existsSync(sd)) continue;
    // parent transcript: Agent tool_use prompt length and tool_result length by tool_use id
    const parent = path.join(pd, sess + '.jsonl');
    const promptLen = {}, resultLen = {};
    if (fs.existsSync(parent)) for (const e of rd(parent)) {
      const c = e.message && e.message.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type === 'tool_use' && b.name === 'Agent') promptLen[b.id] = JSON.stringify(b.input || {}).length;
        if (b.type === 'tool_result') resultLen[b.tool_use_id] = len(b.content);
      }
    }
    for (const f of fs.readdirSync(sd).filter((x) => x.endsWith('.jsonl'))) {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(sd, f.replace('.jsonl', '.meta.json')), 'utf8')); } catch (e) {}
      const es = rd(path.join(sd, f));
      const seen = new Set();
      const turns = [];
      let model = '';
      for (const e of es) {
        if (e.type !== 'assistant' || !e.message || !e.message.usage || seen.has(e.message.id)) continue;
        seen.add(e.message.id);
        model = e.message.model;
        const u = e.message.usage;
        turns.push({ fresh: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, out: u.output_tokens || 0 });
      }
      if (!turns.length) continue;
      const first = turns[0];
      const firstPrompt = es.find((e) => e.type === 'user');
      rows.push({
        type: meta.agentType || '?', model,
        firstCtx: first.fresh + first.cached,
        firstPromptChars: firstPrompt ? len(firstPrompt.message.content) : 0,
        turns: turns.length,
        totIn: turns.reduce((a, t) => a + t.fresh + t.cached, 0),
        totFresh: turns.reduce((a, t) => a + t.fresh, 0),
        totOut: turns.reduce((a, t) => a + t.out, 0),
        mainPrompt: promptLen[meta.toolUseId], mainResult: resultLen[meta.toolUseId],
      });
    }
  }
}
const by = {};
for (const r of rows) (by[r.type + ' | ' + r.model] = by[r.type + ' | ' + r.model] || []).push(r);
console.log(`subagent runs: ${rows.length}`);
console.log('type | model | n | firstCtx med (p10) | promptChars med | turns med | totIn med | totFresh med | totOut med | mainPromptChars med | mainResultChars med');
for (const [k, rs] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  const g = (f) => rs.map(f).filter((x) => typeof x === 'number');
  console.log([k, rs.length, `${med(g((r) => r.firstCtx))} (${pct(g((r) => r.firstCtx), 0.1)})`, med(g((r) => r.firstPromptChars)), med(g((r) => r.turns)),
    med(g((r) => r.totIn)), med(g((r) => r.totFresh)), med(g((r) => r.totOut)), med(g((r) => r.mainPrompt)), med(g((r) => r.mainResult))].join(' | '));
}
