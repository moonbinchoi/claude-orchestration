// PostToolUse on Write|Edit: Claude Code silently drops an agent or skill whose frontmatter fails strict YAML
// (e.g. CRLF plus an unquoted ": ", claude-code #80890). Run the CLI's own validator on the folder that holds it.
// `claude plugin validate` reads a folder named agents/ or skills/; a single .md file is misread as JSON.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Returns the agents/ or skills/ folder to validate, or null when the file is neither.
export function targetDir(file) {
  if (!file) return null;
  const parts = path.resolve(String(file)).split(/[\\/]/);
  const n = parts.length;
  if (n >= 2 && parts[n - 2].toLowerCase() === 'agents' && /\.md$/i.test(parts[n - 1])) return parts.slice(0, n - 1).join(path.sep);
  if (n >= 3 && parts[n - 1] === 'SKILL.md' && parts[n - 3].toLowerCase() === 'skills') return parts.slice(0, n - 2).join(path.sep);
  return null;
}

function main(raw) {
  const input = JSON.parse(raw);
  const t = input.tool_input || {};
  const dir = targetDir(t.file_path);
  if (!dir) return 0;
  const r = spawnSync('claude', ['plugin', 'validate', dir], { encoding: 'utf8', timeout: 30000 });
  if (r.status === 0 || r.error || r.status === null) return 0; // validator missing or timed out: fail open
  process.stderr.write(`claude plugin validate ${dir} failed: Claude Code will not load the file(s) named below, which may include files other than the one just written. Fix their frontmatter (quote values containing ": ") and save again.\n${(r.stdout || '') + (r.stderr || '')}`);
  return 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let code = 0;
    try { code = main(raw); } catch { code = 0; } // fail open: a validator bug must not block edits
    process.exit(code);
  });
}
