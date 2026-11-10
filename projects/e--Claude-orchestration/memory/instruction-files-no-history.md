---
name: instruction-files-no-history
description: "Git-tracked instruction files (rules, agents, skills, docs, memory in ~/.claude) hold only current instructions and state; change history stays in git log"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ca186d87-6af8-4e88-b530-5d9a66b71c33
  modified: 2026-11-10T06:30:46.741Z
---

When editing a git-tracked instruction file, write only the current instruction or state. Leave out change history: commit hashes, "was deleted/replaced/moved", dates of changes, and how a decision came about. Point to a record file when the reader needs the background.

**Why:** user instruction 2026-11-10: "지침 문서는 지침만 들고 있게 해"; git already keeps the history.

**How to apply:** applies to `~/.claude` tracked files, including the memory dir ([[orchestration-remote-repo]]). Commit messages carry the change story instead.
