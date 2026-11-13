// query-facts: facts the code can compute at call time for a Jev query's state (agent type and description, Scope path count).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { guard } from './jev-tier.mjs';

// no dot or slash, so a type can never name a file outside agentsDir
const TYPE = /^[A-Za-z][\w:-]{0,63}$/;
// shortcut: section bounds are matched by heading words, so prose that repeats a heading miscounts; parse the brief structure if the count is ever applied live
// logged briefs are whitespace-collapsed, so a label also counts right after a sentence end ("... done. Scope: ...")
const SCOPE_START = /(?:#{2,}\s*|\*\*)scope(?:\*\*)?:?|(?:^|\n|[.!?)`"']\s+)scope:/i;
const SCOPE_END = /(?:#{2,}\s*|\*\*|\n|[.!?)`"']\s+)(?:skills|return|context|goal)\b/i;

// the frontmatter `description` line, when guard() accepts it (400 characters at most, no paths, code or secrets)
function describe(type, agentsDir) {
  let text;
  try { text = readFileSync(join(agentsDir, type + '.md'), 'utf8'); } catch { return undefined; }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const d = frontmatter && /^description:\s*(.+)$/m.exec(frontmatter[1]);
  const s = d?.[1].trim();
  return s && guard(s) === null ? s : undefined;
}

function scopePaths(brief) {
  const start = typeof brief === 'string' ? SCOPE_START.exec(brief) : null;
  if (!start) return undefined;
  const rest = brief.slice(start.index + start[0].length);
  const end = SCOPE_END.exec(rest);
  return ((end ? rest.slice(0, end.index) : rest).match(/\S*[\\/]\S*/g) ?? []).length;
}

// a fact that cannot be computed is left out
export function computeFacts({ agentType, brief, agentsDir = join(homedir(), '.claude', 'agents') } = {}) {
  const facts = {};
  if (typeof agentType === 'string' && TYPE.test(agentType)) {
    facts.agent = { type: agentType };
    // plugin types (with ':') have no file in agentsDir
    const d = agentType.includes(':') ? undefined : describe(agentType, agentsDir);
    if (d) facts.agent.description = d;
  }
  const n = scopePaths(brief);
  if (n !== undefined) facts.scope_paths = n;
  return facts;
}
