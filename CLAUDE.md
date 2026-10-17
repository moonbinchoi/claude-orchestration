# claude-orchestration

This repo is the source of truth for the orchestration rules, role agents, and guard hook installed under `~/.claude`.

- To install or re-apply, follow `INSTALL.md`.
- Edit files here, run `node hooks/orchestration-guard.test.js` (must print `ok`), then apply with `INSTALL.md`.
- If a file under `~/.claude` was edited directly, copy it back here before committing.
- `analysis/` scripts read `~/.claude/projects/` transcripts. Usage is in `README.md`.
