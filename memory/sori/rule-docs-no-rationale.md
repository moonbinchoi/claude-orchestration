---
name: rule-docs-no-rationale
description: "Sori rule docs (ORCHESTRATION.md, .claude/agents/*.md) hold rules only — no reasons, evidence, sources, or metaphors"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3c80afd5-1b76-4347-8b3b-1cd79e53fcc2
  modified: 2026-09-23T07:10:49.185Z
---

ORCHESTRATION.md and the agent definition files are rule documents that Claude Code only reads and applies. Write the rules alone; add a reason only when the rule cannot be applied correctly without it.

**Why:** The user said so on 2026-09-23, after research findings had been written into ORCHESTRATION.md as rationale paragraphs, URLs, and measured numbers.

**How to apply:** When editing these files, state rules as short imperative bullets. Put evidence and sources in the chat reply, not in the file. Related: [[orchestrate-only]], [[no-hard-wrap-in-files]].
