// query-attributes: reads the first `Attributes: name=value; ...` line of a text into typed state attributes.
const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const WORD = /^[a-z][a-z0-9_]{0,23}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const ANSWER_NAME = /model|tier|effort|difficulty/;
const ANSWER_VALUE = ['haiku', 'sonnet', 'opus', 'fable'];
const MAX = 8;

// bad values come back as undefined; a digit run too large for a finite number is a bad value too
function valueOf(raw) {
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (NUMBER.test(raw)) { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
  return WORD.test(raw) ? raw : undefined;
}

// dropped entries carry the name and the reason only, never the value
export function parseAttributes(text) {
  const attributes = {};
  const dropped = [];
  const line = typeof text === 'string' ? /^Attributes:(.*)$/m.exec(text) : null;
  for (const piece of line ? line[1].split(';') : []) {
    const item = piece.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    const name = eq < 0 ? item : item.slice(0, eq).trim();
    if (eq < 0 || !NAME.test(name)) { dropped.push({ name: null, reason: 'bad_item' }); continue; }
    const value = valueOf(item.slice(eq + 1).trim());
    const reason = value === undefined ? 'bad_value'
      : ANSWER_NAME.test(name) || ANSWER_VALUE.includes(value) ? 'names_answer'
      : Object.hasOwn(attributes, name) ? 'duplicate'
      : Object.keys(attributes).length >= MAX ? 'too_many'
      : null;
    if (reason) dropped.push({ name, reason });
    else attributes[name] = value;
  }
  return { attributes, dropped };
}
