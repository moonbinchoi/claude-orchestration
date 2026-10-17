# Apply to this PC

Follow these steps when asked to apply this repo. `CLAUDE_HOME` is `~/.claude` with forward slashes (e.g. `C:/Users/<user>/.claude`).

1. Copy files, overwriting:
   - `ORCHESTRATION.md` → `CLAUDE_HOME/ORCHESTRATION.md`
   - `agents/*.md` → `CLAUDE_HOME/agents/`
   - `hooks/orchestration-guard.js`, `hooks/orchestration-guard.test.js` → `CLAUDE_HOME/hooks/`
   Before overwriting, diff each target. If a target differs from the repo and is newer, stop and ask which version wins.
2. Merge `settings/hooks.json` into `CLAUDE_HOME/settings.json` under `hooks`, replacing `{{CLAUDE_HOME}}`. Keep every other setting and every other hook. Replace any existing entry whose args point to `orchestration-guard.js` instead of adding a duplicate.
3. Run `node CLAUDE_HOME/hooks/orchestration-guard.test.js`. It must print `ok`.
4. Report which projects should enable it. A project is enabled by adding `@~/.claude/ORCHESTRATION.md` to its `CLAUDE.md`; add the line only to projects the user names.

Do the edits under `CLAUDE_HOME` in the main session with Edit/Write or shell copies; subagents are denied writes there in auto mode.
