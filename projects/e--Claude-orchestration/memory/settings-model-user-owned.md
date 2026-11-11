---
name: settings-model-user-owned
description: "The \"model\" value in ~/.claude/settings.json is the user's own, changes often; never flag it"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 707486f2-c972-4766-85a7-f37655380067
  modified: 2026-11-11T11:15:17.058Z
---

The `model` key in `~/.claude/settings.json` is set by the user and changes freely (e.g. sonnet <-> opus). An uncommitted diff on that line is expected.

**Why:** the user sets it and changes it freely, so reporting it as an unrelated uncommitted change is noise.

**How to apply:** Leave that line out of reports; do not ask about it. Other settings.json changes still need a backup and an approved diff. Related: [[global-orchestration-design]].

Commit rules: ~/.claude/hooks/commit-procedure.md.
