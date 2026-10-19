// claim-scope: the part of a report a claim belongs to: its blank-line-delimited paragraph plus, when a heading precedes it,
// that heading's section. Markdown marks (`, **) are ignored when finding the claim. '' when the claim is not found.
const HEADING = /^\s*#{1,6}\s/;

export function scopeOf(report, original) {
  const lines = String(report).replace(/`|\*\*/g, '').split('\n');
  const at = lines.findIndex((l) => l.includes(original));
  if (at < 0) return '';
  let a = at;
  let b = at;
  while (a > 0 && lines[a - 1].trim()) a--;
  while (b < lines.length - 1 && lines[b + 1].trim()) b++;
  const para = lines.slice(a, b + 1);
  let h = at;
  while (h >= 0 && !HEADING.test(lines[h])) h--;
  if (h < 0) return para.join('\n');
  let e = at + 1;
  while (e < lines.length && !HEADING.test(lines[e])) e++;
  return [...lines.slice(h, e), ...para].join('\n');
}
