const d = require(process.argv[2]);
const M = 1e-6, cw = 8 * M, rd = 0.2 * M;
const est = (c) => (c.tok != null ? c.tok : c.chars / d.ratio);
const cost = (c) => est(c) * (cw + rd * c.carry);
// classify by the effective command: skip leading cd/export/env assignments
const cls = (cmd) => {
  const segs = cmd.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter((s) => s && !/^(cd|export|set|S=|[A-Z_]+=)/.test(s));
  const s = (segs[0] || '').replace(/^(sudo|time)\s+/, '');
  const w = s.split(/\s+/)[0].replace(/^["']|["']$/g, '').toLowerCase();
  if (w === 'git') return 'git';
  if (w === 'gh') return 'gh';
  if (/^(cat|head|tail|sed|awk|less|type|get-content|wc)$/.test(w)) return 'read (cat/head/sed...)';
  if (/^(grep|rg|find|ls|dir|tree|get-childitem|select-string|du|stat)$/.test(w)) return 'search/list (grep/find/ls)';
  if (/(gradlew|gradle|mvn|mvnw)/.test(w)) return 'gradle/maven';
  if (/^(npm|npx|pnpm|yarn|bun)$/.test(w)) return 'npm/npx';
  if (/^node(\.exe)?$/.test(w)) return /test/.test(s) ? 'node test' : 'node script';
  if (/^(python3?|py|pip|uv|pytest)$/.test(w)) return 'python';
  if (/^(curl|wget|invoke-webrequest)$/.test(w)) return 'curl';
  if (/^(java|javac|jshell)$/.test(w)) return 'java';
  if (/^(echo|printf|mkdir|cp|mv|rm|touch|chmod|ln)$/.test(w)) return 'fs ops/echo';
  return 'other:' + w.slice(0, 20);
};
const by = {};
let all = 0;
for (const c of d.calls.filter((c) => c.tool === 'Bash' || c.tool === 'PowerShell')) {
  const k = cls(c.cmd || '');
  const g = (by[k] = by[k] || { n: 0, cost: 0, toks: [] });
  g.n++; g.cost += cost(c); g.toks.push(est(c)); all += cost(c);
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };
const rows = Object.entries(by).sort((a, b) => b[1].cost - a[1].cost);
console.log(`Bash+PowerShell cost total ${all.toFixed(2)}`);
console.log('class | n | cost | share | tok p50 p90 | %>1K');
for (const [k, g] of rows.slice(0, 25)) console.log(`${k} | ${g.n} | ${g.cost.toFixed(2)} | ${Math.round(100 * g.cost / all)}% | ${q(g.toks, .5)} ${q(g.toks, .9)} | ${Math.round(100 * g.toks.filter((x) => x > 1000).length / g.n)}%`);
const other = rows.filter(([k]) => k.startsWith('other:'));
console.log(`other total: n ${other.reduce((a, [, g]) => a + g.n, 0)}, share ${Math.round(100 * other.reduce((a, [, g]) => a + g.cost, 0) / all)}%`);
