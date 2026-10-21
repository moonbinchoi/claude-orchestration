// report-claims: extract checkable claims from a subagent report by local English regex. No IO.
import { STATUS, isEnglish } from './guard-common.mjs';

const FILE = /([\w.@-]+\.(?:mjs|cjs|js|jsx|ts|tsx|json|jsonl|md|py|go|rs|java|cs|css|html|ya?ml|toml|sh|ps1|cpp|c|h|txt))\b/i;
const FILE_ALL = new RegExp(FILE.source, 'gi');
const NEG = /\b(not|n't|never|no|unchanged|untouched|without)\b/i;
const URL = /https?:\/\/[^\s)>\]]+/i;
const TEST_SUBJ = /\b(tests?|specs?|suites?|build|builds|lint|linting|typecheck|tsc|compiles?)\b/i;
const TEST_OK = /\b(pass(?:es|ed|ing)?|succe\w+|green|clean|ok)\b/i;
// structured handoff: items under a `Files changed:` line, until a blank line or heading, are one file_change claim per path
const HANDOFF = /^Files changed:$/i;
const FILES_HEADER = /^[\s*#>-]*\**(changed|created|modified|edited|touched|files?\s+(changed|created|modified|touched))\b[^.]*[:.]?\**\s*$/i;
// suggestions and work by someone else are not this agent's own file changes
const NOT_OWN = /\b(?:suggest\w*|recommend\w*|should|could|consider\w*)\b|\bfix:|\bthe (?:implementer|worker|author)\b/i;
// "Node.js" and friends look like file names
const LIB = /\b(?:node|next|vue|nuxt|express|react|d3|three)\.js\b/gi;
const noLib = (s) => s.replace(LIB, 'library');
// the number next to a pass verb: "52 tests pass", "52 passed", "passed 52", "52/52"
const PASS_COUNT = /\b(\d+)\s+(?:[\w-]+\s+)?(?:tests?|specs?|cases?)\s+(?:(?:are|were|now|all|also|still)\s+)*(?:pass\w*|succe\w+|green|ok)\b|\b(\d+)\s+(?:pass|passed|passing)\b|\bpass(?:ed|es|ing)?:?\s+(\d+)\b|\b(\d+)\/\d+\b/gi;
const ANY_COUNT = /\b(\d+)\s+(?:[\w-]+\s+)?(?:tests?|specs?|cases?)\b/gi;

// quoted text, and backtick spans holding more than one word, are not the agent's own claim; single-token backticks stay (file names)
// spans are matched pair by pair first, so text between two single-token spans is never taken as a span
const QUOTED = /"[^"\n]*"|\u201c[^\u201d\n]*\u201d|`[^`\n]*`/g;
export const unquote = (s) => s.replace(QUOTED, (m) => (m[0] === '`' && !/\s/.test(m) ? m : ' '));
// code citations and review findings quote or discuss someone else's text
export const CITE = /\b\w+\.\w+:\d+|^Line \d+:|^Claim:/;
const FINDING = /^(?:Issues?|Findings?|Scenario|Fix)\b/;
const BULLET = /^([-*]|\d+[.)]|#+)\s+/;
export const isCitedLine = (l) => { const t = String(l).replace(/`|\*\*/g, '').trim().replace(BULLET, ''); return CITE.test(t) || FINDING.test(t); };
const PATH_URL = /https?:\/\/\S+|(?:[\w.-]*[\\/])+[\w.-]*/g;

const FILE_VERB = new RegExp(String.raw`\b(?:creat\w+|add(?:ed|ing)?|edit\w*|updat\w+|modif\w+|wrote|written|fix(?:ed)?|changed|renam\w+)\b[^.\n]{0,60}?${FILE.source}(?!:\d)`, 'i');

export const TYPES = [
  ['test_pass', (s) => TEST_SUBJ.test(s) && TEST_OK.test(s) && !NEG.test(s.replace(/\b0 (fail\w*|errors?)\b/gi, '')) && !/\bfail\w*/i.test(s.replace(/\b0 fail\w*/gi, ''))],
  ['file_change', (s) => !URL.test(s) && !NEG.test(s) && !NOT_OWN.test(s) && FILE_VERB.test(noLib(s))],
  ['source', (s) => (URL.test(s) || /\b(?:official|the) (?:docs?|documentation)\b|\bofficial source\b/i.test(s)) && /\b(read|verified|confirmed|according to|checked)\b/i.test(s) && !NEG.test(s)],
  ['all_done', (s) => /\b(all|every|each)\b/i.test(s) && /\b(done|complete\w*|processed|covered|finished|implemented)\b/i.test(s) && !NEG.test(s)],
  ['verified', (s0) => { const s = s0.replace(PATH_URL, ' '); return /\b(verif(?:y|ied)|confirm\w*|check(?:ed)?|validat\w*)\b/i.test(s) && !NEG.test(s); }],
];

// The claimed pass count of a sentence: { count } when one, { ambiguous: true } when several candidates, {} when none.
function countOf(s) {
  const pick = (re) => [...new Set([...s.matchAll(re)].map((m) => Number(m.slice(1).find((g) => g != null))))];
  const found = pick(PASS_COUNT);
  const all = found.length ? found : pick(ANY_COUNT);
  return all.length === 1 ? { count: all[0] } : all.length ? { ambiguous: true } : {};
}

// agentType 'reviewer' has no edit tools: it makes no file_change claims.
// Returns { claims: [{ type, original, files?, count?, ambiguous?, url? }], sample: [string] }.
// sample: random share (rate) of English sentences that matched no type, for a miss-rate review.
export function extractClaims(report, { random = Math.random, rate = 0.05, agentType = null } = {}) {
  // reviewer has no edit tools; researcher's check is WebFetch, covered by 'source'
  const types = TYPES.filter(([k]) => !(agentType === 'reviewer' && k === 'file_change') && !(agentType === 'researcher' && k === 'verified'));
  const claims = [];
  const sample = [];
  let fence = false;
  let inFiles = false;
  let handoff = false;
  let inFinding = false;
  let first = true;
  for (const raw of String(report).split('\n')) {
    if (raw.trim().startsWith('```')) { fence = !fence; continue; }
    if (fence) continue;
    const line = unquote(raw).replace(/`|\*\*/g, '').trim();
    if (!line) { inFiles = false; handoff = false; inFinding = false; continue; }
    if (first) { first = false; if (STATUS.test(line) && line.replace(STATUS, '').replace(/^\W+/, '') === '') continue; }
    if (/^#+\s/.test(line)) inFinding = false;
    if (FINDING.test(line.replace(BULLET, ''))) inFinding = true;
    if (inFinding) continue;
    if (HANDOFF.test(line)) { handoff = true; continue; }
    if (/^#+\s/.test(line)) handoff = false;
    if (handoff) {
      // one claim per bullet: its first path; later paths on the line are notes ("a.mjs: renamed from old.mjs")
      const f = BULLET.test(line) ? noLib(line.replace(BULLET, '')).match(FILE)?.[1] : null;
      if (f && agentType !== 'reviewer') claims.push({ type: 'file_change', original: line.replace(BULLET, '').slice(0, 300), files: [f] });
      continue;
    }
    const bullet = /^([-*]|\d+[.)])\s+/.test(line);
    if (FILES_HEADER.test(line) && !FILE.test(line)) { inFiles = true; continue; }
    if (inFiles && !bullet) inFiles = false;
    const body = line.replace(BULLET, '');
    const sentences = inFiles ? [body] : body.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/);
    for (const s0 of sentences) {
      const s = s0.trim();
      if (s.length < 8 || CITE.test(s)) continue;
      const t = inFiles && FILE.test(noLib(s)) && agentType !== 'reviewer' ? 'file_change' : types.find(([, f]) => f(s))?.[0];
      if (!t) { if (isEnglish(s) && random() < rate) sample.push(s.slice(0, 300)); continue; }
      const c = { type: t, original: s.slice(0, 300) };
      if (t === 'file_change') c.files = [...new Set([...noLib(s).matchAll(FILE_ALL)].map((m) => m[1]))];
      if (t === 'test_pass') {
        Object.assign(c, countOf(s));
        c.scoped = FILE.test(s) || /^[\w-]+:/.test(s);
      }
      if (t === 'source') c.url = s.match(URL)?.[0] ?? null;
      claims.push(c);
    }
  }
  return { claims, sample };
}
