---
name: one-file-one-function
description: User wants each code file to own a single function/feature; check proposals against this before extending an existing file
metadata:
  node_type: memory
  type: feedback
  originSessionId: fc04c8b2-1804-4b96-824b-db1ad0436cf2
  modified: 2026-11-10T06:34:40.355Z
---

Each code file should own one function (feature). When a design adds a feature to an existing file, check the file against this rule first and propose a split if it already mixes jobs.

**Why:** the user rejects adding a feature to a file that already mixes jobs (for example hook entry, registry, report parsing and duplicate checks in one file).

**How to apply:** when proposing where code goes, state which single job each file owns; shared helpers go in one shared module, not copied. Mention runtime costs of a split (extra module loads, single entry point) when asked. Related: [[jev-router-project]].
