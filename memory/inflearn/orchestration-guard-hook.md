---
name: orchestration-guard-hook
description: "How the ORCHESTRATION.md delegation guard hook is installed, activated per project, and what is still unverified"
metadata:
  node_type: memory
  type: project
  originSessionId: 2922c7f1-6b0e-4a53-8df4-d11c6db43fbb
  modified: 2026-10-17T09:03:20.572Z
---

Source of truth since 2026-10-17: repo `E:\Claude\claude-orchestration` (private, github.com/moonbinchoi/claude-orchestration); edit there, then apply to `~/.claude` via its `INSTALL.md`. It also holds the pending guard redesign draft (`docs/design/2026-10-17-orchestration-guard-design.md`) and the cost analysis scripts.

Since 2026-09-30 a guard hook enforces `~/.claude/ORCHESTRATION.md`: `~/.claude/hooks/orchestration-guard.js` (self-check: `orchestration-guard.test.js` beside it), registered for PreToolUse and Stop in `~/.claude/settings.json` with mode `ask`.

Activation is per project: the guard does nothing unless a CLAUDE.md found walking up from the session cwd (`CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`) contains the string `ORCHESTRATION.md`. The import line is the single switch for both the document and the hook.

**Why:** the user keeps the orchestration document global but opts projects in by importing it, and wants the hook to follow the same switch. Instructions alone were ignored by the main session, so the hook makes silent non-delegation visible.

**How to apply:** to enable in another project, add `@~/.claude/ORCHESTRATION.md` to its CLAUDE.md; do not register the hook per project. Behaviour: main session gets `ask` on the 9th direct tool call since the prompt's last Agent/SendMessage call (again every 8); a delegation resets the count but no longer exempts the rest of the prompt (changed 2026-10-16). Stop blocks once when over that count and no assistant text of the turn contains `Delegation exception: <reason>`; it reads `transcript_path` (assistant entries after the first entry with the prompt's `promptId`, since assistant entries carry no `promptId`) and falls back to `last_assistant_message`. Subagent calls (`agent_id` present) always pass. Measured in the VSCode extension: `ask` does show a prompt in auto permission mode, and settings hook edits apply to the running session.
