// Shared Jev (TypeSafe System One) client. Request and response shapes follow the OpenAPI spec
// (https://api.typesafe.ai/openapi.json); every API-shape assumption lives in systemOne() so it is easy to fix.

const URL_SYSTEMONE = 'https://api.typesafe.ai/v1/systemone';
const MAX_BODY_BYTES = 64 * 1024;
const NON_ASCII_MAX = 0.05;

export class JevError extends Error {
  // kind: credentials | http | network | invalid-response | cancelled | input
  // reason: short machine string used as fallback_reason (never contains key, headers or bodies)
  constructor(kind, reason, message) {
    super(message ?? reason);
    this.name = 'JevError';
    this.kind = kind;
    this.reason = reason;
  }
}

export function assertEnglish(text) {
  const letters = String(text).match(/\p{L}/gu) ?? [];
  const nonAscii = letters.filter((c) => c.codePointAt(0) > 127).length;
  if (letters.length && nonAscii / letters.length > NON_ASCII_MAX) {
    throw new JevError('input', 'non_english', 'Text is not English (too many non-ASCII letters). Rewrite it in English before sending; the client never translates.');
  }
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new JevError('invalid-response', 'invalid_response', 'Response body exceeds 64 KiB.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const bad = (m) => new JevError('invalid-response', 'invalid_response', `Invalid response: ${m}`);

// optional: names of questions whose bad answer is dropped instead of failing the whole response
function validate(json, questions, optional = []) {
  if (!json || typeof json !== 'object' || (json.model !== undefined && typeof json.model !== 'string')) throw bad('shape');
  if (!json.answers || typeof json.answers !== 'object') throw bad('answers');
  for (const [q, def] of Object.entries(questions)) {
    try { check(json.answers[q], q, def); } catch (e) {
      if (!optional.includes(q)) throw e;
      delete json.answers[q];
    }
  }
  return json;
}

function check(a, q, def) {
  if (!a || typeof a !== 'object') throw bad(`missing answer ${q}`);
  const type = def.type ?? 'choice';
  // noul answers carry only p in 0..1: {type: 'noul', noul: 0.63}
  if (type === 'noul') {
    if (typeof a.noul !== 'number' || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) throw bad(`noul ${q}`);
    return;
  }
  // score criteria are a list; probabilities are keyed by level index "0".."n-1"
  const expected = type === 'score' ? def.criteria.map((_, i) => String(i)) : Object.keys(def.criteria);
  const p = a.probabilities;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad(`probabilities ${q}`);
  const keys = Object.keys(p);
  if (keys.length !== expected.length || !expected.every((k) => keys.includes(k))) throw bad(`keys ${q}`);
  let sum = 0;
  let max = -1;
  for (const k of keys) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw bad(`value ${q}`);
    sum += v;
    max = Math.max(max, v);
  }
  if (Math.abs(sum - 1) > 1e-4) throw bad(`sum ${q}`);
  if (type === 'score') {
    if (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > expected.length - 1) throw bad(`score ${q}`);
  } else if (typeof a.choice !== 'string' || !(a.choice in p) || p[a.choice] !== max) throw bad(`choice ${q}`);
  if (typeof a.confidence !== 'number' || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) throw bad(`confidence ${q}`);
}

export async function systemOne({ body, fetchImpl = fetch, signal, timeoutMs = 1500, optional = [] }) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevError('credentials', 'credentials', 'TYPESAFE_API_KEY is not set.');
  // object state (named fields) is checked as its JSON text, which keeps non-ASCII letters as-is
  assertEnglish(typeof body.state === 'string' ? body.state : JSON.stringify(body.state));
  const abortError = () => {
    const isTimeout = signal.reason?.name === 'TimeoutError';
    return new JevError(isTimeout ? 'network' : 'cancelled', isTimeout ? 'timeout' : 'cancelled', isTimeout ? 'Deadline reached.' : 'Cancelled.');
  };
  if (signal?.aborted) throw abortError();
  const attempt = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, attempt]) : attempt;
  let bytes;
  let status;
  try {
    const res = await fetchImpl(URL_SYSTEMONE, {
      method: 'POST',
      redirect: 'error',
      signal: combined,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    status = res.status;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new JevError('http', `http_${status}`, `HTTP status ${status}.`);
    }
    bytes = await readCapped(res);
  } catch (e) {
    if (e instanceof JevError) throw e;
    if (attempt.aborted) throw new JevError('network', 'timeout', 'Attempt timed out.');
    if (signal?.aborted) throw abortError();
    throw new JevError('network', 'network', 'Network error.');
  }
  let json;
  try {
    json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw bad('not JSON');
  }
  return validate(json, body.questions, optional);
}
