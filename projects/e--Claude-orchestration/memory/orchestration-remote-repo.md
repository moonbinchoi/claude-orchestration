---
name: orchestration-remote-repo
description: "Private GitHub repo moonbinchoi/claude-orchestration holds ~/.claude (rules, agents, jev, CLAUDE.md, orchestration memories); main is the live, default branch since the 2026-11-08 merge; what is excluded"
metadata:
  node_type: memory
  type: project
  originSessionId: 0d5329b8-5f40-48fe-9521-af2719a00796
  modified: 2026-11-08T09:26:56.081Z
---

Pushed 2026-10-22: `~/.claude` (git repo, remote `origin` = private GitHub moonbinchoi/claude-orchestration). The earlier repo of the same name (previous orchestration design, flat ORCHESTRATION.md layout) is preserved as branch `old` and tag `v1` (both at 89c888c); the remote `main` was renamed to `old`, no force push was used. Remote branches: `main` (6948105, pre-Jev baseline), `jev-router` (0ca25cc), `jev-f1-main-pick` (live config, tracks origin, **default branch** until the merge).

Tracked set (`~/.claude/.gitignore` is a whitelist): rules/, agents/, jev/, settings.json, CLAUDE.md, and the memory dir `projects/e--Claude-orchestration/memory/`. Never whitelist `projects/` wholesale (transcripts live there). Jev `*.jsonl` logs are git-ignored (contain the local user name).

Kept out on purpose: `rules/design-workflow.md` (sdlc plugin routing rule, local only) and the settings.json hunks for the sdlc plugin (enabledPlugins entry, local-directory marketplace E:\Claude\sdlc-plugin) plus the user-owned model/effort lines. So the working tree's settings.json stays dirty; do not commit those hunks.

**Why:** user wants an offsite backup of the current orchestration design, with the global rules and the sdlc plugin fully independent of each other (see [[sdlc-plugin]]).

Merged 2026-11-08 (user ran it): `main` fast-forwarded to 85bce8c, pushed, default branch is `main` again, `main` is checked out (live config). `jev-router` and `jev-f1-main-pick` are now ancestors of / equal to `main`; commit new work on `main`.

**How to apply:** Remote-changing git/gh commands (branch rename, push, default-branch change) were denied by the auto-mode classifier as "Git Destructive" even after user approval; the user ran them in their own terminal, then Claude verified with read-only `gh api` / `gh repo view`. A plain fast-forward `git push origin main` ran fine on 2026-11-08 when the user asked for it; for branch renames, force pushes or default-branch changes, give the user the exact commands with `cd`. Memory files are tracked, so edits show as uncommitted changes in ~/.claude.
