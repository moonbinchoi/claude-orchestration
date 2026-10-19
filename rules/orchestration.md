# Orchestration

These rules govern the main conversation. A subagent that loads this file follows its own agent instructions instead.

## Delegation is a standing request

The user requests delegation in the cases below. Treat each case as the user asking for a subagent, even when no message in this turn mentions one.

Delegate when the work:
- sweeps 10 or more files;
- produces verbose output the main conversation will not reread: test, build, and lint runs, log scans, documentation lookups;
- splits into 3 or more independent pieces, such as several research questions. Dispatch the pieces in parallel, in one message.

Keep the work in the main conversation when it is a small task or a single lookup, when each step needs the previous step's full output, when it edits files other running work also edits, or when it needs back-and-forth with the user.

## Routing

- Make the judgment before dispatching `worker`, in the main conversation or through `analyst`.
- Chain agents through the main conversation, for example `explorer` → `analyst` → `worker` → `reviewer`.
- Send every review to `reviewer`, including reviews a skill dispatches as `general-purpose`, and keep the skill's prompt and model.
- Use a fork when the task needs this conversation's context: it shares the cache but runs on the main model. Use a fresh agent otherwise.

## Model

Pass `model` only in these cases:
- `worker`, on every dispatch: `sonnet` when judgment remains inside the task (a prose-only brief, coordinated edits across files, writing for a reader, a transformation with ambiguous rules); `haiku` otherwise (command runs, exact edits, single-file mechanical changes, explicit-rule transformations, file operations).
- `reviewer`: `sonnet` for a small mechanical diff.
- `fable`: only when the user asks for it.

On BLOCKED:
- `worker`: settle the judgment, in the main conversation or through `analyst`, and re-dispatch with a sharper brief. Pass a higher model only when the brief was already exact.
- `explorer`: send the question to `analyst` when it needs understanding; re-dispatch with more context when it lacked context.
- `researcher`: pass `opus` when it lacked reasoning; re-dispatch with more context when it lacked context.
- `analyst`, `reviewer`: tell the user.

## Brief

Write every brief with these parts:
- **Goal**: the outcome and how to tell it is done.
- **Context**: the paths, facts, and decisions the agent needs. Pass large inputs as file paths; leave out conversation history.
- **Scope**: what to touch and what to leave.
- **Skills**: the skills to invoke when the work follows a method, such as TDD. Choose them here; skills that question the user or dispatch subagents stay in the main conversation.
- **Return**: the report shape, a length cap if it differs from the default, and an output path when the full result is long.

Before acting on a claim a decision depends on, read the lines it cites yourself.
