// failure-cause: classify why one subagent task failed. Pure: no IO, no Jev.
import { createHash } from 'node:crypto';
import { guard } from './jev-tier.mjs';
import { PATH_URL_EMAIL, isEnglish, jaccard, tokens } from './guard-common.mjs';

const CAUSE_MAX = 300;
const EN_MAX = 200;
const KEYWORD = /error|failed|fail|denied|cannot|can't|unable|not found|refused|unauthori[sz]ed|forbidden|permission|missing|timeout|timed out|오류|실패|거부|찾을 수 없|권한|인증|초과/i;
const VERB = /failed|fails|error|denied|cannot|can't|unable|refused|not found|timed out|실패|오류|거부|찾을 수 없/i;
// "No permission issues found." and similar boilerplate are never a cause
const NEGATED = /\bno\s+(issues?|errors?|problems?|failures?)\b|\bwithout (errors?|issues?)\b|\b0 (errors?|failures?)\b|문제(가)? 없|오류(가)? 없/i;
// status codes count only with context (HTTP 429, error: 503, 401 Unauthorized), never as a bare number
const code = (codes, words) => `\\b(?:HTTP|status|error|code)\\b\\W{0,3}(?:${codes})\\b|\\b(?:${codes})\\s+(?:${words})`;
// first match wins
const SUBKINDS = [
  ['transient', new RegExp(`${code('429|503|529', 'Too Many Requests|Service Unavailable|Overloaded')}|rate.?limit(?:ed| exceeded| reached| hit)?\\b|overloaded_error|\\b(?:server|api|service|model) (?:is |was )?overloaded\\b|too many requests|ECONNRESET|ETIMEDOUT|(?:temporarily|service) unavailable`, 'i')],
  ['auth', new RegExp(`${code('401', 'Unauthorized')}|unauthori[sz]ed|authentication (?:failed|error|required)|invalid (?:api )?key|api key (?:is )?(?:missing|invalid|not set)|(?:invalid|missing|expired) credentials?|credentials? (?:missing|not found|expired|invalid)|token (?:expired|invalid|is invalid)|not logged in|login required|인증(?:에)? 실패|인증 오류|인증이 필요|자격 증명|로그인(?:이)? 필요|로그인 실패`, 'i')],
  ['permission', new RegExp(`${code('403', 'Forbidden')}|EACCES|EPERM|permission denied|access (?:is )?denied|access forbidden|not permitted|액세스가 거부|권한이 없|권한(?:이)? 거부`, 'i')],
  ['network', /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|network (error|unreachable)|could not resolve host|connection refused|네트워크 (?:오류|에러|연결)|연결할 수 없|호스트를 찾을 수 없/i],
  ['missing_tool', /command not found|is not recognized as|cannot find module|module not found|not installed|spawn \S+ ENOENT|내부 또는 외부 명령|인식되지 않습니다/i],
];
const subkindOf = (s) => SUBKINDS.find(([, re]) => re.test(s))?.[0] ?? null;
const isKeyword = (l) => !NEGATED.test(l) && (KEYWORD.test(l) || SUBKINDS.some(([, re]) => re.test(l)));
const pick = (list) => list.find(isEnglish) ?? list[0];

export function redact(s) {
  return String(s)
    .replace(/\w+:\/\/\S+/g, '<url>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/[A-Za-z]:\\(?:[\w.-]+(?: [\w.-]+)*\\)*[\w.-]*/g, '<path>') // drive path, segments may contain spaces
    .replace(/[A-Za-z]:\/\S*/g, '<path>')
    .replace(/\\\\\S+/g, '<path>')
    .replace(/~\/\S*/g, '<path>')
    .replace(/(^|[\s("'`=])\/[\w.-]+(?:\/[\w.-]*)*/g, '$1<path>')
    .replace(/[\w.-]+(?:\/[\w.-]+)+/g, '<path>')
    .replace(/[\w.-]+(?:\\[\w.-]+(?: [\w.-]+)*(?=\\))*\\[\w.-]+/g, '<path>') // relative backslash path
    .replace(/(?<![A-Za-z])(authorization|token|key)\b(?:\s*[:=]\s*|\s+(?=\S*\d))(?:bearer\s+)?\S+/gi, '$1 <redacted>')
    .replace(/(?<![A-Za-z])(password|passwd|secret|bearer)\b(?:\s*[:=]\s*|\s+)\S+/gi, '$1 <redacted>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g, '<token>')
    .replace(/\d{4,}/g, '<n>')
    .replace(/\s+/g, ' ').trim();
}

const sigOf = (s) => createHash('sha256').update(redact(s).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ')).digest('hex');

// a, b: classifyFailure results (or plain cause strings)
export function compareCauses(a, b) {
  const orig = (x) => (typeof x === 'string' ? x : x?.cause_original) ?? '';
  const sig = (x) => (typeof x === 'string' ? sigOf(x) : x?.cause_sig ?? null);
  const sa = sig(a);
  return {
    sig_equal: sa !== null && sa === sig(b),
    jaccard: jaccard(tokens(redact(orig(a)).toLowerCase()), tokens(redact(orig(b)).toLowerCase())),
  };
}

export function classifyFailure({ text, status, launchStatus } = {}) {
  const failed = status === 'BLOCKED' || status === 'PARTIAL' || (typeof launchStatus === 'string' && /error|fail/i.test(launchStatus));
  if (!failed) return null;
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  // remainder of the first line after the status word, then the later lines
  const cands = [lines[0]?.replace(/^[\s*#_>`-]*(?:DONE|PARTIAL|BLOCKED)\b[\s*:_`–—-]*/, '').trim(), ...lines.slice(1)].filter(Boolean);
  const kw = cands.filter(isKeyword);
  const verb = kw.filter((l) => VERB.test(l));
  const line = (verb.length ? pick(verb) : kw.length ? pick(kw) : cands[0]) ?? null;
  // subkind from the cause line, plus the next line only when that is a quoted localized (non-English) message
  const next = cands[cands.indexOf(line) + 1];
  const subkind = line === null ? null : subkindOf(next && !isEnglish(next) ? `${line}\n${next}` : line);
  if (line === null) return { subkind, lang: null, cause_original: null, cause_en: null, cause_sig: null, skip_reason: 'no_cause' };
  const cause_original = line.slice(0, CAUSE_MAX);
  const lang = isEnglish(cause_original) ? 'en' : 'ko';
  const out = { subkind, lang, cause_original, cause_en: null, cause_sig: sigOf(cause_original), skip_reason: null };
  if (lang === 'ko') { out.skip_reason = 'non_english'; return out; }
  const en = redact(cause_original).slice(0, EN_MAX);
  const bad = guard(en) ?? (PATH_URL_EMAIL.test(en) ? 'path_url_email' : null);
  if (bad) out.skip_reason = bad; else out.cause_en = en;
  return out;
}
