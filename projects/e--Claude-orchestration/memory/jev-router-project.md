---
name: jev-router-project
description: "Jev model router for orchestration: live hooks, where the records live, non-obvious facts; effort shadow to 2026-11-22"
metadata:
  node_type: memory
  type: project
  originSessionId: 90b13c1f-288a-416d-aa29-484471434ed4
  modified: 2026-11-10T06:31:57.423Z
---

Live hooks: router applied by PreToolUse hook `router-guard.mjs` as min(rule model, Jev tier), and main never calls jev-tier; main-session pick `main-pick.mjs` on the first prompt only; dispatch-guard log-only; retry-guard `notice`; `stale-resume.mjs` on UserPromptSubmit. All Jev hooks enter through `jev/agent-hooks.mjs`. Effort shadow runs to 2026-11-22, then the promotion session (`E:/Claude/orchestration/docs/design/2026-11-08-jev-model-lock-effort/prompt-effort-promotion.md`).

Records (design, decisions, history): `E:\Claude\orchestration\docs\research\global-orchestration\scratch\jev-router-design.md` and `jev-router-status.md`; shadow review `E:\Claude\orchestration\docs\research\global-orchestration\shadow-review-2026-10-22\`; research synthesis `E:\Claude\orchestration\docs\research\global-orchestration\jev-research-2026-10-22\00-synthesis.md`; re-measure decisions `E:/Claude/orchestration/docs/design/2026-11-07-jev-shadow-remeasure/decision.md` and `status.md` there. Key is user env var `TYPESAFE_API_KEY`; `node jev-tier.mjs doctor` checks it and warns when `jev-latest` moves.

**Why:** quality-first model routing at near-zero cost; Jev accuracy was unmeasured, hence the shadow phases.

Non-obvious facts:
- PreToolUse `updatedInput` can rewrite Agent `model` and `effort` (CLI 2.1.302, foreground).
- In the VS Code extension subagents report via a `SubagentHandback` tool call, so SubagentStop `last_assistant_message` is empty; read the handback from `agent_transcript_path`. The hook often runs before the handback line is on disk (131 of 166 stops on 2.1.312+), so it re-reads up to 1.5 s and logs `waited_ms`; check that field next time. `api-request-blob` lines replay old turns, so only `assistant` lines count as a handback. The CLI host writes no SubagentHandback.
- VS Code dispatches run in the background, so a PostToolUse(Agent) notice does not fire at the dispatch there.
- analyst, explorer and researcher have `omitClaudeMd: true`: only the brief reaches them, never CLAUDE.md or `rules/*.md`.
- Nested `claude -p` inherits CLAUDE_CODE_ENTRYPOINT; `CLAUDE_CODE_SESSION_ATTENDED=0` marks it. The Bash sandbox blocks brace-and-quote heredocs.
- Jev cannot tell a lie from a true claim by text; sentence-only stop detection fails even with Jev (translated check: 5 of 6 blocks false).
- User decisions can be missing from design records; when the user says something was decided, check the records against transcripts.

**How to apply:** do not end or promote the effort shadow on your own; the user decides from the shadow records (the user prefers that over new paired experiments). Put report-format fixes in `rules/orchestration.md`, not `agents/*.md` (user principle: an agent definition holds only content about that agent). TypeSafe retention is "as long as necessary" (no fixed period; the user accepted it for doctor and synthetic/English summaries only). The English-only guard (>5% non-ASCII) is user-decided; the user rejected a zero-tolerance variant. Related: [[global-orchestration-design]], [[jev-usage-reference]].
