// run-command: does a shell command line run a test, build or lint? Judged on each segment's leading program only.
// Looks inside `bash -c "..."`, `powershell -Command "..."`, `uv run`, `npx`/`uvx`/`pnpm dlx` and loop bodies (`do cmd`); quoted text is not split.

const PKG = /^(?:npm|pnpm|yarn|bun|deno)$/;
const SOLO = /^(?:pytest|mvn|gradlew?|tsc|vitest|jest|mocha|eslint)$/;
const SUB_TEST = /^(?:go|cargo|dotnet)$/;
const PY = /^(?:python3?|py)$/;
const SHELL = /^(?:bash|sh|zsh|pwsh|powershell)$/;

const unquote = (w) => w.replace(/^(["'])([\s\S]*)\1$/, '$2');
const dropFlags = (ws) => { let i = 0; while (i < ws.length && ws[i].startsWith('-')) i++; return ws.slice(i); };

// split on && || ; | and newlines outside quotes
function split(command) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ';' || ch === '|' || ch === '\n' || (ch === '&' && command[i + 1] === '&')) {
      segs.push(cur);
      cur = '';
      if (command[i + 1] === ch && ch !== ';' && ch !== '\n') i++;
      continue;
    }
    cur += ch;
  }
  return [...segs, cur];
}

function wordsRun(words) {
  const prog = (words[0] ?? '').split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat)$/i, '');
  const rest = words.slice(1);
  if (prog === 'node') return rest.includes('--test') || rest.some((w) => /\.test\.(?:mjs|cjs|js|ts)$/.test(w));
  if (PY.test(prog)) return rest[0] === '-m' && /^(?:pytest|unittest)$/.test(rest[1] ?? '');
  if (SHELL.test(prog)) { const i = rest.findIndex((w) => /^-(?:c|command)$/i.test(w)); return i >= 0 && rest[i + 1] != null && isRunCommand(unquote(rest[i + 1])); }
  if (prog === 'uv') return rest[0] === 'run' && wordsRun(dropFlags(rest.slice(1)));
  if (/^(?:npx|uvx|bunx)$/.test(prog)) return wordsRun(dropFlags(rest));
  if (prog === 'pnpm' && rest[0] === 'dlx') return wordsRun(dropFlags(rest.slice(1)));
  if (PKG.test(prog)) return /^(?:run\s+)?(?:test|build|lint)\b/.test(rest.join(' '));
  if (SUB_TEST.test(prog)) return rest[0] === 'test';
  return SOLO.test(prog);
}

function segmentRuns(seg) {
  const s = seg.trim().replace(/^\(+/, '').replace(/^(?:(?:do|then|else)\s+)/, '').replace(/^(?:\w+=\S*\s+)+/, '');
  return wordsRun(s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []);
}

export const isRunCommand = (command) => split(String(command ?? '')).some(segmentRuns);
