# claude-orchestration

My Claude Code user configuration (`~/.claude`): rules that make the main conversation delegate work to cheaper subagents, six subagent definitions, guard hooks, and **Jev**, a hook-based router that picks a model tier per dispatch.

This is a personal setup published as a reference, not a drop-in package. It was built and tested on Windows (VS Code extension and CLI) and contains absolute paths for that machine.

## What is in it

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | Global writing and answering rules (replies in Korean, agent-facing text in English, a marker for decisions the user has not confirmed). |
| `rules/orchestration.md` | When the main conversation delegates, which agent gets which work, how to pick each agent's model, and the brief format. |
| `agents/` | Subagents: `explorer` (locate), `analyst` (explain), `researcher` (web), `worker` (execute a brief), `reviewer` (review), and `general-purpose` (twin of `worker`, kept because some plugins dispatch it by name). |
| `hooks/` | Commit guard (shows the commit procedure, requires a `Co-Authored-By` trailer, blocks `--no-verify`/force options), agent/skill frontmatter validation, a session-start health check, and a git pre-commit hook. |
| `jev/` | The Jev router and its guards (see below), plus `docs/jev-usage.md`. |
| `skills/jev/` | `/jev` skill: ask Jev ad-hoc classification questions from a session. |
| `settings.json` | Hook wiring, env flags, enabled plugins. |
| `projects/e--Claude-orchestration/memory/` | Claude Code auto-memory for the project where this config is developed. |

## How it works

**Orchestration.** `rules/orchestration.md` treats delegation as a standing request: sweeps of 10+ files, verbose runs (tests, builds, log scans), and 3+ independent pieces go to subagents. Bulk input that needs judgment is split: `explorer` extracts candidates to a short file, and `analyst` or the main conversation judges only that file. Every review goes to `reviewer`.

**Jev router.** Jev is a fast text classifier from [TypeSafe](https://docs.typesafe.ai/). The hooks in `jev/agent-hooks.mjs` run on `UserPromptSubmit`, `PreToolUse(Agent)`, `PostToolUse(Agent)`, and `SubagentStop`:

- `router-guard` lowers a dispatch's `model` when Jev rates the brief's `Summary:` line as needing a cheaper tier. A `Model-lock: <model>` line in the brief prevents lowering.
- `dispatch-guard` flags duplicate dispatches; `retry-guard` flags a retry that fails for the same cause.
- `stale-resume` warns before resuming a large context after more than an hour idle (the prompt cache has expired).
- `main-pick-trigger` asks the main session, on its first prompt, to check its own model against Jev's pick.

Every Jev call fails open: without the API key, or when the API is slow or down, the hooks do nothing.

## Requirements

- Claude Code (CLI or VS Code extension)
- Node.js 20.3 or later, on `PATH`
- Git (Git for Windows: the session check looks for its `zoneinfo` data)
- Optional: a TypeSafe API key in the `TYPESAFE_API_KEY` environment variable, for the Jev hooks
- Plugins referenced in `settings.json`: `superpowers`, `mattpocock-skills`, `ponytail`, `andrej-karpathy-skills`. The `sdlc` plugin is a separate local repository and is not included.

## Trying it

Back up your own `~/.claude` first; this replaces it.

1. Clone into `~/.claude`.
2. In `settings.json`, `skills/jev/SKILL.md`, and `jev/main-pick-trigger.mjs`, replace the absolute `C:/Users/<user>/.claude/...` paths with your own home directory.
3. Enable the git hook: `git config core.hooksPath hooks/git`.
4. Set `TYPESAFE_API_KEY` if you want the Jev hooks to act.

Paths under `E:\Claude\...` in the docs and memory files point to design records on my machine that are not part of this repository.

## Tests

Each `*.test.mjs` file runs on its own and exits non-zero on failure:

```sh
for f in hooks/*.test.mjs hooks/git/*.test.mjs jev/*.test.mjs; do node "$f" || echo "FAIL $f"; done
```

## License

[MIT](LICENSE)
