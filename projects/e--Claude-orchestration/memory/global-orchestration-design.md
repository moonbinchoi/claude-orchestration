---
name: global-orchestration-design
description: "Global orchestration (rules + 6 agents) designed, installed, and verified on 2026-10-18; where the design record lives and what was verified"
metadata:
  node_type: memory
  type: project
  originSessionId: 93c80f96-34b0-4218-8750-e9e729deee3e
  modified: 2026-10-21T18:17:34.784Z
---

Installed 2026-10-18 after a grilling session. Requirements and the sourced design record: `E:\Study\Inflearn\.scratch\global-orchestration\requirements.md` and `research.md` (section 12 = verification results).

Installed:
- `~/.claude/rules/orchestration.md`: standing delegation request, routing, model passing, BLOCKED handling, brief format.
- `~/.claude/agents/`: explorer (haiku), analyst (opus high), worker (haiku, main passes sonnet/haiku every dispatch), general-purpose (twin of worker on sonnet, kept because superpowers dispatches it by name), researcher (sonnet), reviewer (opus).
- `~/.claude/settings.json` env `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`.
- `~/.claude/CLAUDE.md`: English for anything only Claude or agents read.

Non-obvious facts learned:
- Agent names are case-sensitive; lowercase `explore` does not replace built-in `Explore`.
- Main only sees agent name + description + tools; model/effort/body are not visible to it.
- A haiku subagent that loads CLAUDE.md follows "Reply to the user in Korean" unless the English instruction is the first body line.
- Opus's injected "don't spawn unless asked" text is overridden by the rule's "standing request" wording (verified).

2026-10-19 cost review: step-5 scans spent ~94% on Opus analysts (bulk reading on a fixed-Opus agent). Proposals A-L, evidence and open decisions: `E:\Study\Inflearn\.scratch\global-orchestration\improvements-2026-10-19.md` Applied 2026-10-19: A-G, I-L; verification in `research.md` §13 (A/C/F/G observed; B/D not observed because main judged extracts itself). H applied 2026-10-19 (~/.claude commit cdc24dd): Haiku citation accuracy matched Opus (n=19) but it narrowed scope silently, so bulk briefs now require per-item status and the judge step does dedupe and value. The user decides when to hand out bulk work; no usage-limit check (cancelled).

`~/.claude` is a git repo (whitelist `.gitignore`: rules/, agents/, settings.json only). Commit there after editing those files.

**Why:** Goal was lower token cost without quality loss.

**How to apply:** Edit worker.md and general-purpose.md together. Related: [[parallelize-bulk-work]].
