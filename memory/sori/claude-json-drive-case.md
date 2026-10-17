---
name: claude-json-drive-case
description: ~/.claude.json projects keys are drive-letter case-sensitive; Sori needs both E:/ and e:/ entries for the ORCHESTRATION.md import to load
metadata:
  node_type: memory
  type: project
  originSessionId: 0d2a2fb2-8af5-44fb-b9cc-f44fcab3fe26
  modified: 2026-09-23T15:31:01.158Z
---

~/.claude.json keys projects by path string without normalizing drive-letter case. VS Code opens Sori as `e:/Claude/Sori`, PowerShell as `E:/Claude/Sori`. On 2026-09-24 a `"e:/Claude/Sori"` entry (hasTrustDialogAccepted, hasClaudeMdExternalIncludesApproved, hasClaudeMdExternalIncludesWarningShown = true) was added by hand next to the existing uppercase one; after that the `@~/.claude/ORCHESTRATION.md` import in CLAUDE.md loaded. Backup: ~/.claude.json.bak.

**Why:** without the matching-case entry the external import is silently left as a literal `@` line.

**How to apply:** if the import shows up as a literal line again, check that both case variants exist in ~/.claude.json first; a running session can rewrite the file on exit, so re-add with sessions closed if the entry vanished.
