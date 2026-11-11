---
name: orchestration-remote-repo
description: "Private GitHub repo moonbinchoi/claude-orchestration holds ~/.claude (rules, agents, jev, CLAUDE.md, orchestration memories); main is the live, default branch; what is excluded"
metadata:
  node_type: memory
  type: project
  originSessionId: 0d5329b8-5f40-48fe-9521-af2719a00796
  modified: 2026-11-11T11:15:20.957Z
---

`~/.claude` is a git repo; remote `origin` = private GitHub moonbinchoi/claude-orchestration. `main` is the checked-out (live) and default branch. Branch `old` and tag `v1` hold the previous orchestration design (flat ORCHESTRATION.md layout). `jev-router` and `jev-f1-main-pick` are contained in `main`. The local `origin/HEAD` ref points to `jev-f1-main-pick`; `git remote set-head origin -a` refreshes it.

Tracked set (`~/.claude/.gitignore` is a whitelist): rules/, agents/, hooks/, jev/, skills/jev/, settings.json, CLAUDE.md, and the memory dir `projects/e--Claude-orchestration/memory/`. Never whitelist `projects/` wholesale (transcripts live there). Jev `*.jsonl` logs are git-ignored (contain the local user name).

Kept out on purpose: the settings.json hunks for the sdlc plugin (enabledPlugins entry, local-directory marketplace E:\Claude\sdlc-plugin) plus the user-owned model/effort lines. So the working tree's settings.json stays dirty.

**Why:** user wants an offsite backup of the current orchestration design, with the global rules and the sdlc plugin fully independent of each other (see [[sdlc-plugin]]).

**How to apply:** Memory files are tracked, so edits show as uncommitted changes in ~/.claude.

Commit rules: ~/.claude/hooks/commit-procedure.md.
