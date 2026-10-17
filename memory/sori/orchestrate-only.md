---
name: orchestrate-only
description: "In the Sori project, orchestration policy lives in the repo at ORCHESTRATION.md; CLAUDE.md imports it so it auto-loads"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9fb84244-bbe3-46b1-8d2c-ff0c7d3a7183
  modified: 2026-09-20T08:58:38.302Z
---

In E:\Claude\Sori, the subagent orchestration policy is a repo file: `ORCHESTRATION.md`, imported by `Sori/CLAUDE.md` so it loads every session. Read it there rather than relying on this memory — the repo file is the single source of truth and this note exists only to explain why it is there.

Per-agent config (model, effort, tools) lives in `.claude/agents/{investigator,editor,verifier,architect}.md`. Two things that are easy to get wrong and are stated in the policy file: do not pass `model` on an Agent call (it overrides the definition file), and there is no way to set effort at dispatch time — choosing the agent is the only effort lever.

**Why:** User set delegation as a standing rule for this project (2026-09-17), then on 2026-09-20 moved the policy into the repo so every session picks it up automatically instead of depending on recalled memory.
**How to apply:** Follow `ORCHESTRATION.md` in the repo. See [[sori-fork-customization]], [[no-hard-wrap-in-files]].
