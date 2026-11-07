---
name: harness-design-docs-location
description: "sdlc design docs (intent/spec/plan) for global harness changes live in E:\\Claude\\orchestration\\docs\\design, not in the ~/.claude repo"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 26eb969e-7ebe-4fa2-bcef-2b50fb8cdb23
  modified: 2026-11-07T08:55:31.135Z
---

Put intent.md, spec.md and plan.md for any change to the global harness (`~/.claude` rules, agents, jev hooks) under `E:\Claude\orchestration\docs\design\YYYY-MM-DD-<slug>\`. Do not commit them into `~/.claude`. The user approved the move on 2026-11-07, after the first two token-audit designs had been committed to `~/.claude/jev/docs/design/`.

**Why:** global harness sessions run in E:\Claude\orchestration, so the sdlc skills find `docs/design/<slug>` there for resume. It also keeps sdlc output out of the orchestration repo, which matches how the sdlc plugin is kept independent (see [[orchestration-remote-repo]], [[sdlc-plugin]]).

**How to apply:** E:\Claude\orchestration is not a git repo, so these docs have no version history or offsite backup unless the user decides to `git init` it. Code commits in ~/.claude should name the design folder path in their message.
