---
name: settings-model-user-owned
description: "The \"model\" value in ~/.claude/settings.json is the user's own, changes often; never flag it or commit it"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 707486f2-c972-4766-85a7-f37655380067
  modified: 2026-10-19T14:26:35.337Z
---

The `model` key in `~/.claude/settings.json` is set by the user and changes freely (e.g. sonnet <-> opus). An uncommitted diff on that line is expected.

**Why:** In session 4c (2026-10-19) I listed it under "out-of-scope findings" only because git showed it as an unrelated uncommitted change; the user said it is theirs and fluid.

**How to apply:** Leave that line out of commits and reports; do not ask about it. Other settings.json changes still need a backup and an approved diff. Related: [[global-orchestration-design]].
