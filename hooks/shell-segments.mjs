// Tokenizer for Bash/PowerShell command strings: splits into segments of words (+ heredoc bodies).
// shortcut: `2>&1` / `&>` split at `&`, upgrade if a caller needs it.

// Read a `<<[-]DELIM` starting at i (on the `<<`). Returns { delim, strip, end } with end after the delimiter.
function readHeredocStart(s, i) {
  let j = i + 2;
  const strip = s[j] === '-';
  if (strip) j++;
  while (s[j] === ' ' || s[j] === '\t') j++;
  let delim = '';
  while (j < s.length && !/[\s;&|()<>]/.test(s[j])) {
    if (s[j] !== "'" && s[j] !== '"' && s[j] !== '\\') delim += s[j];
    j++;
  }
  return { delim, strip, end: j };
}

// Read heredoc body lines starting at i (start of a line). Returns { body, end } with end after the delimiter line.
function readBody(s, i, delim, strip) {
  const lines = [];
  while (i <= s.length) {
    let nl = s.indexOf('\n', i);
    if (nl < 0) nl = s.length;
    let line = s.slice(i, nl);
    const cmp = (strip ? line.replace(/^\t+/, '') : line).replace(/\r$/, '');
    i = nl + 1;
    if (cmp === delim) break;
    lines.push(line);
    if (nl >= s.length) break;
  }
  return { body: lines.join('\n'), end: Math.min(i, s.length) };
}

// i is just after `$(` inside double quotes; returns the index after the matching `)`.
function skipSub(s, i) {
  let depth = 1;
  while (i < s.length) {
    if (s.startsWith('<<<', i)) { i += 3; continue; }
    if (s.startsWith('<<', i)) {
      const h = readHeredocStart(s, i);
      const nl = s.indexOf('\n', h.end);
      if (nl < 0) return s.length;
      i = readBody(s, nl + 1, h.delim, h.strip).end;
      continue;
    }
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i + 1;
    i++;
  }
  return s.length;
}

// shell 'powershell': `\` is literal, backtick escapes (and continues lines) outside single quotes.
export function segments(command, shell = 'bash') {
  const s = command;
  const esc = shell === 'powershell' ? '`' : '\\';
  const out = [];
  let cur = { words: [], heredocs: [] };
  let word = null; // { text, bare } while inside a word
  let pending = []; // heredocs awaiting the next newline
  const endWord = () => { if (word) { cur.words.push(word); word = null; } };
  const endSeg = () => {
    endWord();
    if (cur.words.length || cur.heredocs.length) out.push(cur);
    cur = { words: [], heredocs: [] };
  };
  const add = (text, bare = '') => { word ??= { text: '', bare: '' }; word.text += text; word.bare += bare; };

  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '\n') {
      endWord();
      i++;
      for (const p of pending) {
        const r = readBody(s, i, p.delim, p.strip);
        p.seg.heredocs.push(r.body);
        i = r.end;
      }
      pending = [];
      endSeg();
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord(); i++;
    } else if ('&|;()'.includes(c)) {
      endSeg(); i++;
    } else if (c === '$' && s[i + 1] === '(' && !word) {
      i++; // `$(` outside quotes: the `(` splits
    } else if (c === '<' && shell === 'powershell' && s[i + 1] === '#') {
      endWord();
      const e = s.indexOf('#>', i + 2);
      i = e < 0 ? s.length : e + 2;
    } else if (c === '#' && !word) {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '<' && s.startsWith('<<<', i)) {
      endWord(); i += 3;
    } else if (c === '<' && s[i + 1] === '<') {
      const h = readHeredocStart(s, i);
      endWord();
      pending.push({ delim: h.delim, strip: h.strip, seg: cur });
      i = h.end;
    } else if ((c === '@') && !word && (s[i + 1] === "'" || s[i + 1] === '"') && /^\r?\n/.test(s.slice(i + 2, i + 4))) {
      const close = s[i + 1] + '@';
      const nl = s.indexOf('\n', i + 2);
      const idx = s.indexOf('\n' + close, nl);
      const end = idx < 0 ? s.length : idx;
      add(end > nl ? s.slice(nl + 1, end).replace(/\r$/, '') : '');
      i = idx < 0 ? s.length : idx + 1 + close.length;
    } else if (c === "'") {
      const e = s.indexOf("'", i + 1);
      const stop = e < 0 ? s.length : e;
      add(s.slice(i + 1, stop));
      i = stop + 1;
    } else if (c === '"') {
      add('');
      i++;
      while (i < s.length && s[i] !== '"') {
        if (shell === 'powershell' && s[i] === esc && i + 1 < s.length) { word.text += s[i + 1]; i += 2; }
        else if (s[i] === esc && (s[i + 1] === '"' || s[i + 1] === esc)) { word.text += s[i + 1]; i += 2; }
        else if (s[i] === '$' && s[i + 1] === '(') { const e = skipSub(s, i + 2); word.text += s.slice(i, e); i = e; }
        else word.text += s[i++];
      }
      i++;
    } else if (c === esc && /^\r?\n/.test(s.slice(i + 1, i + 3))) {
      i += s[i + 1] === '\r' ? 3 : 2; // line continuation
    } else if (c === esc && i + 1 < s.length) {
      add(s[i + 1], s[i + 1]); i += 2;
    } else {
      add(c, c); i++;
    }
  }
  endSeg();
  return out;
}
