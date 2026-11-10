---
name: orchestration-remote-repo
description: "Private GitHub repo moonbinchoi/claude-orchestration holds ~/.claude (rules, agents, jev, CLAUDE.md, orchestration memories); main is the live, default branch; what is excluded"
metadata:
  node_type: memory
  type: project
  originSessionId: 0d5329b8-5f40-48fe-9521-af2719a00796
  modified: 2026-11-10T06:34:18.139Z
---

`~/.claude` is a git repo; remote `origin` = private GitHub moonbinchoi/claude-orchestration. `main` is the checked-out (live) and default branch; commit new work on it. Branch `old` and tag `v1` hold the previous orchestration design (flat ORCHESTRATION.md layout). `jev-router` and `jev-f1-main-pick` are contained in `main`. The local `origin/HEAD` ref points to `jev-f1-main-pick`; `git remote set-head origin -a` refreshes it.

Tracked set (`~/.claude/.gitignore` is a whitelist): rules/, agents/, hooks/, jev/, skills/jev/, settings.json, CLAUDE.md, and the memory dir `projects/e--Claude-orchestration/memory/`. Never whitelist `projects/` wholesale (transcripts live there). Jev `*.jsonl` logs are git-ignored (contain the local user name).

Kept out on purpose: the settings.json hunks for the sdlc plugin (enabledPlugins entry, local-directory marketplace E:\Claude\sdlc-plugin) plus the user-owned model/effort lines. So the working tree's settings.json stays dirty; do not commit those hunks.

**Why:** user wants an offsite backup of the current orchestration design, with the global rules and the sdlc plugin fully independent of each other (see [[sdlc-plugin]]).

**How to apply:** the auto-mode classifier denies branch renames, force pushes and default-branch changes as "Git Destructive" even after user approval: give the user the exact commands with `cd`, then verify with read-only `gh api` / `gh repo view`. A plain fast-forward `git push origin main` runs when the user asks for it. Memory files are tracked, so edits show as uncommitted changes in ~/.claude.
