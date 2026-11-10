---
name: harness-design-docs-location
description: "In E:\\Claude\\orchestration every work unit (design docs, handoff, status, artifacts) lives in one folder docs/design/YYYY-MM-DD-<slug>; never in ~/.claude"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 26eb969e-7ebe-4fa2-bcef-2b50fb8cdb23
  modified: 2026-11-10T06:34:39.283Z
---

One work unit = one folder: `E:\Claude\orchestration\docs\design\YYYY-MM-DD-<slug>\`. Put everything for that unit in it: intent.md, spec.md, plan.md, the handoff, the status file, scripts, data and results. When one unit holds several sdlc designs, give each its own subfolder named `YYYY-MM-DD-<slug>` and pass that path to the sdlc skills. Do not commit any of this into `~/.claude`.

**Why:** the user wants one folder per work unit. The sdlc skills create and look up designs under `docs/design/`, and `docs/design/2026-10-22-design-docs-concepts/design-docs-concepts.md` §184-187 chose `docs/design/YYYY-MM-DD-<slug>/` and rejected root-level feature folders.

**How to apply:**
- The orchestration folder is not a git repo yet (the user will decide later), so these files have no history or backup.
- A unit folder without an sdlc intent.md, such as the removal archive or the concepts doc, will show up as unfinished when `/sdlc:write-design-docs` is asked to continue without a slug. Decline it there. Never resume the knowledge-layer eval ([[knowledge-layer-removed]]).
- Code commits in ~/.claude name the design folder path. Related: [[orchestration-remote-repo]], [[sdlc-plugin]].
