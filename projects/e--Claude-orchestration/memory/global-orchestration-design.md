---
name: global-orchestration-design
description: "Global orchestration (rules + 6 agents): where the design record lives, non-obvious facts about agents and cost"
metadata:
  node_type: memory
  type: project
  originSessionId: 93c80f96-34b0-4218-8750-e9e729deee3e
  modified: 2026-11-10T06:34:25.940Z
---

Requirements and the sourced design record: `E:\Claude\orchestration\docs\research\global-orchestration\requirements.md` and `E:\Claude\orchestration\docs\research\global-orchestration\scratch\research.md` (§12 verification, §13 cost fixes). Cost proposals and evidence: `E:\Claude\orchestration\docs\research\global-orchestration\scratch\improvements-2026-10-19.md`.

Installed: `~/.claude/rules/orchestration.md`, `~/.claude/agents/` (6 agents; general-purpose is kept because superpowers dispatches it by name), `~/.claude/settings.json` env `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`, `~/.claude/CLAUDE.md`. Read those files for current content.

Non-obvious facts learned:
- Agent names are case-sensitive; lowercase `explore` does not replace built-in `Explore`.
- Main only sees agent name + description + tools; model/effort/body are not visible to it.
- A haiku subagent that loads CLAUDE.md follows "Reply to the user in Korean" unless the English instruction is the first body line.
- Opus's injected "don't spawn unless asked" text is overridden by the rule's "standing request" wording (verified).
- Bulk reading on a fixed-Opus agent dominates cost (~94% of a scan).
- Haiku matches Opus on citation accuracy (n=19) but narrows scope silently; hence per-item status in bulk briefs and dedupe/value in the judge step.

Do not add a usage-limit check; the user decides when to hand out bulk work.

`~/.claude` is a git repo; commit there after editing tracked files (tracked set: [[orchestration-remote-repo]]).

**Why:** Goal was lower token cost without quality loss.

**How to apply:** read the installed files for current content. Edit `agents/worker.md` and `agents/general-purpose.md` together; only general-purpose.md says so.
