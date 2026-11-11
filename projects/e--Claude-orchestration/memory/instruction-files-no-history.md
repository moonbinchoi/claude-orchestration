---
name: instruction-files-no-history
description: "Git-tracked instruction files (rules, agents, skills, docs, memory in ~/.claude) hold only current instructions and state; change history stays in git log"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ca186d87-6af8-4e88-b530-5d9a66b71c33
  modified: 2026-11-11T11:15:17.838Z
---

When editing a git-tracked instruction file, write only the current instruction or state. Leave out change history: commit hashes, "was deleted/replaced/moved", dates of changes, and how a decision came about. Point to a record file when the reader needs the background.

**Why:** the user wants instruction documents to hold only instructions; git already keeps the history.

**How to apply:** applies to `~/.claude` tracked files, including the memory dir ([[orchestration-remote-repo]]), unless a document's purpose is the record itself (for example `jev/docs/jev-evidence.md`).

Commit rules: ~/.claude/hooks/commit-procedure.md.
