# Orchestration

These rules govern the main conversation. A subagent that loads this file follows its own agent instructions instead.

## Delegation is a standing request

The user requests delegation in the cases below. Treat each case as the user asking for a subagent, even when no message in this turn mentions one.

Delegate when the work:
- sweeps 10 or more files;
- produces verbose output the main conversation will not reread: test, build, and lint runs, log scans, documentation lookups;
- splits into 3 or more independent pieces, such as several research questions. Dispatch the pieces in parallel, in one message.

Keep the work in the main conversation when it needs fewer than 3 tool turns, when each step needs the previous step's full output, when it edits files other running work also edits, or when it needs back-and-forth with the user.

## Routing

- Make the judgment before dispatching `worker`, in the main conversation or through `analyst`.
- Split bulk input that needs judgment (log scans, 10 or more files) in two: `explorer` extracts candidates to a short file in a fixed format; `analyst` or the main conversation judges only that file, including dedupe and value.
- Chain agents through the main conversation, for example `explorer` → `analyst` → `worker` → `reviewer`.
- Send every review to `reviewer`, including reviews a skill dispatches as `general-purpose`, and keep the skill's prompt and model; the Jev router may still lower the model.
- When `reviewer` checks a subagent's output, put `Verifies: <agent_id>` in its brief and require an `Exaggeration: none|minor|serious` line after its status line.
- Use a fork when the task needs this conversation's context: it shares the cache but runs on the main model. Use a fresh agent otherwise.

## Jev router

A PreToolUse hook lowers each dispatch's `model` to the lower of the rule model (the `model` you pass, else the agent's frontmatter model) and Jev's tier for the brief's `Summary:` line. Dispatch with the model the Model section chooses; never call jev-tier yourself.
- The `Summary:` line is the only text sent to Jev: English, 1-2 sentences, no secrets, paths, code, or raw user prompt.
- Add a line `Model-lock: <model>` (haiku, sonnet, opus, or fable) when the model must not be lowered: the user chose it, a project rule fixes this agent's model, or On BLOCKED raised it. The hook dispatches that model; a lock line without one is denied.

## Model

Before dispatching bulk work, decide each agent's model and expected input size.

Pass `model` only in these cases:
- `worker`, on every dispatch: `sonnet` when judgment remains inside the task (a prose-only brief, coordinated edits across files, writing for a reader, a transformation with ambiguous rules); `haiku` otherwise (command runs, exact edits, single-file mechanical changes, explicit-rule transformations, file operations).
- `analyst`: `sonnet` when the input is bulk.
- `fable`: only when the user asks for it.

Run at most 2 Opus agents at once, counted by the model you dispatch with: `analyst` and `reviewer` without a `model` override, and forks of an Opus main. Several at once exhaust the usage limit.

On BLOCKED:
- `worker`: settle the judgment, in the main conversation or through `analyst`, and re-dispatch with a sharper brief. Pass a higher model only when the brief was already exact.
- `explorer`: send the question to `analyst` when it needs understanding; re-dispatch with more context when it lacked context.
- `researcher`: pass `opus` when it lacked reasoning; re-dispatch with more context when it lacked context.
- `analyst`, `reviewer`: tell the user.

## Brief

Write every brief with these parts:
- **Summary**: the first line, `Summary: <1-2 sentence English summary>`. When a task is split, name each piece's scope in it. When a dispatch repeats earlier work on purpose (A/B arms, calibration series, variants), add a line `Repeat: <reason>`.
- **Goal**: the outcome and a checkable completion criterion that covers every item in scope ("every caller updated", not "verify the change").
- **Context**: the paths, facts, and decisions the agent needs, and where to start looking. Pass large inputs as file paths; leave out conversation history.
- **Scope**: what to touch and what to leave. When sources are split across agents, name the sources the others cover.
- **Skills**: the skills to invoke when the work follows a method, such as TDD. Choose them here; skills that question the user or dispatch subagents stay in the main conversation.
- **Return**: the report shape, a length cap if it differs from the default, and an output path when the full result is long. When the agent edits files, require a `Files changed:` line followed by one bullet per edited path. Start any report format the brief defines with a status line: DONE, PARTIAL, or BLOCKED.

State each instruction as the behaviour to perform. Keep prohibitions for hard boundaries, each paired with what to do instead.

For bulk input, tell the agent to read only grep hits, write interim results to the output path as it goes, and keep its context under ~150K tokens. List every input item and require a status for each: done, or skipped with the reason.

Before acting on a claim a decision depends on, read the lines it cites yourself.

## Interruptions

- Resume a stopped agent within an hour; after that, start a fresh one from its interim file. The cache expires after an hour, and resuming rewrites the whole context.
- To stay under a concurrency cap, hold new dispatches until a running agent finishes. Do not stop running agents.

## Long work

- Before exploring to interpret an ambiguous instruction, ask the user once.
- Update status files at phase ends, not after every report.
- At a phase end, write a status file and suggest continuing in a new session.
- When a main session resumes after over an hour idle with a large context, write a status file if none exists and suggest a new session from it.
