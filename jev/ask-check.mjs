// ask-check: validates a /jev request file (format for every item first, then content) without changing it.
import { CJK, PATH_URL_EMAIL } from './guard-common.mjs';
import { guard } from './jev-tier.mjs';
import { redact } from './failure-cause.mjs';

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const TYPES = ['choice', 'score', 'noul'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v !== '';
const onlyKeys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));

class Reject { constructor(rule, where = null) { this.rule = rule; this.where = where; } }
const fail = (rule) => { throw new Reject(rule); };

// one criteria description: a non-empty string, or an object of 1-5 non-empty string fields
const desc = (v) => text(v) || (isObj(v) && Object.keys(v).length >= 1 && Object.keys(v).length <= 5 && Object.entries(v).every(([k, s]) => ID.test(k) && text(s)));

function criteriaOf(q) {
  const c = q.criteria;
  if (q.type === 'score') {
    if (!Array.isArray(c) || c.length < 2 || c.length > 10 || !c.every(desc)) fail('bad_criteria');
  } else if (q.type === 'choice') {
    if (!isObj(c)) fail('bad_criteria');
    const ks = Object.keys(c);
    if (ks.length < 2 || ks.length > 10) fail('bad_criteria');
    if (!ks.every((k) => ID.test(k))) fail('bad_id');
    if (!ks.every((k) => desc(c[k]))) fail('bad_criteria');
  } else if (c !== undefined) {
    if (!isObj(c) || Object.keys(c).sort().join() !== 'false,true' || !desc(c.true) || !desc(c.false)) fail('bad_criteria');
  }
}

function formatItem(it, seen) {
  if (!isObj(it) || !onlyKeys(it, ['id', 'state', 'questions', 'companions'])) fail('bad_shape');
  if (typeof it.id !== 'string' || !ID.test(it.id)) fail('bad_id');
  if (seen.has(it.id)) fail('duplicate_item');
  seen.add(it.id);
  if (!isObj(it.state) || !isObj(it.questions)) fail('bad_shape');
  const fields = Object.keys(it.state);
  if (fields.length > 20) fail('too_many_fields');
  if (fields.length < 1) fail('bad_shape');
  for (const k of fields) {
    if (!ID.test(k)) fail('bad_id');
    const v = it.state[k];
    if (typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v))) fail('bad_value');
  }
  const ids = Object.keys(it.questions);
  if (ids.length > 10) fail('too_many_questions');
  if (ids.length < 1) fail('bad_shape');
  for (const id of ids) {
    const q = it.questions[id];
    if (!ID.test(id)) fail('bad_id');
    if (!isObj(q) || !onlyKeys(q, ['type', 'instructions', 'criteria']) || !TYPES.includes(q.type) || !text(q.instructions)) fail('bad_shape');
    criteriaOf(q);
  }
  const comp = it.companions ?? {};
  if (!isObj(comp)) fail('bad_shape');
  for (const [k, v] of Object.entries(comp)) {
    if (!ID.test(k) || typeof v !== 'string' || !ID.test(v)) fail('bad_companion');
    if (it.questions[k]?.type !== 'noul' || !['choice', 'score'].includes(it.questions[v]?.type)) fail('bad_companion');
  }
}

// [location, string] pairs in check order
function* strings(it) {
  for (const [k, v] of Object.entries(it.state)) if (typeof v === 'string') yield [`${it.id}.state.${k}`, v];
  for (const [id, q] of Object.entries(it.questions)) {
    const at = `${it.id}.questions.${id}`;
    yield [`${at}.instructions`, q.instructions];
    if (q.criteria !== undefined) for (const [k, v] of Object.entries(q.criteria)) {
      if (typeof v === 'string') yield [`${at}.criteria.${k}`, v];
      else for (const [field, s] of Object.entries(v)) yield [`${at}.criteria.${k}.${field}`, s];
    }
  }
}

const contentRule = (s) => (CJK.test(s) ? 'cjk' : guard(s) ?? (PATH_URL_EMAIL.test(s) ? 'path_url_email' : redact(s) !== s.replace(/\s+/g, ' ').trim() ? 'redactable' : null));

export function checkRequest(raw) {
  try {
    if (Buffer.byteLength(raw) > 32768) fail('file_too_large');
    let data;
    try { data = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { fail('not_json'); }
    if (!isObj(data) || !onlyKeys(data, ['items']) || !Array.isArray(data.items) || data.items.length < 1) fail('bad_shape');
    if (data.items.length > 10) fail('too_many_items');
    const seen = new Set();
    for (const it of data.items) formatItem(it, seen);
    for (const it of data.items) for (const [where, s] of strings(it)) {
      const rule = contentRule(s);
      if (rule) throw new Reject(rule, where);
    }
    return { ok: true, items: data.items.map((it) => ({ id: it.id, state: it.state, questions: it.questions, companions: it.companions ?? {} })) };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, rule: e.rule, where: e.where };
    throw e;
  }
}
