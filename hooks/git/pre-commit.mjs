import { execFileSync } from 'node:child_process';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

try {
  if (!git('diff', '--cached', '--name-only', '--', 'settings.json').trim()) process.exit(0);
  const staged = JSON.parse(git('show', ':settings.json'));
  let head = {};
  try { head = JSON.parse(git('show', 'HEAD:settings.json')); } catch {}
  if (staged.model !== head.model) throw new Error('settings.json: top-level "model" differs from HEAD (user-owned value)');
  const lines = git('diff', '--cached', '-U0', '--', 'settings.json').split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  if (lines.some((l) => /sdlc/i.test(l))) throw new Error('settings.json: staged diff touches sdlc lines (user-owned)');
} catch (e) {
  console.error(`pre-commit: ${e.message}\nSee ~/.claude/hooks/commit-procedure.md for how to stage without settings.json.`);
  process.exit(1);
}
