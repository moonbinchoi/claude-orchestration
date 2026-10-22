---
name: one-file-one-function
description: User wants each code file to own a single function/feature; check proposals against this before extending an existing file
metadata:
  node_type: memory
  type: feedback
  originSessionId: fc04c8b2-1804-4b96-824b-db1ad0436cf2
  modified: 2026-10-19T12:01:28.523Z
---

Each code file should own one function (feature). When a design adds a feature to an existing file, check the file against this rule first and propose a split if it already mixes jobs.

**Why:** in session 4b (2026-10-19) the user rejected extending `dispatch-guard.mjs` with retry logic; the file already mixed hook entry, registry, report parsing and duplicate check.

**How to apply:** when proposing where code goes, state which single job each file owns; shared helpers go in one shared module, not copied. Mention runtime costs of a split (extra module loads, single entry point) when asked. Related: [[jev-router-project]].
