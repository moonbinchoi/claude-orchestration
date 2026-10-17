// Opus 5.5 main (1h cache), Haiku 5.5 subagent. USD per token.
const d = require(process.argv[2]);
const M = 1e-6, cw = 8 * M, rd = 0.2 * M, out = 20 * M;
const est = (c) => (c.tok != null ? c.tok : c.chars / d.ratio);
const ctxCost = (tok, carry) => tok * (cw + rd * carry);
// per-tool share of main-context cost
const by = {}; let all = 0;
for (const c of d.calls) { const v = ctxCost(est(c), c.carry); by[c.tool] = (by[c.tool] || 0) + v; all += v; }
console.log('main-context cost by tool (USD, share):');
for (const [t, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${v.toFixed(2)} (${Math.round(100 * v / all)}%)`);
console.log(`  total: ${all.toFixed(2)}`);
// Grep/Glob clusters: direct vs delegated to Haiku 5.5
const F = 7800;               // haiku-5.5 investigator first-turn context (measured median)
const hk = { cw: 0.2 * M, rd: 0.01 * M, out: 0.5 * M };
const WRAP = 80, FRAME = 100;  // extra main output for Agent call; tool_result framing tokens in main
let direct = 0, pass = 0, summ = 0, summWins = 0;
for (const c of d.clusters) {
  const R = c.tokKnown ? c.resTok : c.resChars / d.ratio;
  const haiku = F * hk.cw + F * hk.rd + R * hk.cw + 50 * c.n * hk.out + R * hk.out;
  const callOut = (c.inChars / 3) * out;
  direct += callOut + ctxCost(R, c.carry);
  pass += callOut + WRAP * out + ctxCost(R + FRAME, c.carry) + haiku;
  const Ret = Math.min(R, 300);
  const s = callOut + WRAP * out + ctxCost(Ret + FRAME, c.carry) + haiku;
  summ += s; if (s < callOut + ctxCost(R, c.carry)) summWins++;
}
const n = d.clusters.length;
console.log(`Grep/Glob clusters: ${n}`);
console.log(`  direct total ${direct.toFixed(3)}  (per cluster ${(direct / n).toFixed(4)})`);
console.log(`  delegate, raw output returned: ${pass.toFixed(3)}  (diff ${(pass - direct).toFixed(3)})`);
console.log(`  delegate, result cut to <=300 tok: ${summ.toFixed(3)}  (diff ${(summ - direct).toFixed(3)}; cheaper in ${summWins}/${n} clusters)`);
console.log(`  haiku cost per delegation (R=500): ${(F * hk.cw + F * hk.rd + 500 * hk.cw + 50 * hk.out + 500 * hk.out).toFixed(4)}`);
