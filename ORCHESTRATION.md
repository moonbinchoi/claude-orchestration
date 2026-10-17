# Subagent Orchestration

**MAIN SESSION ONLY.** Subagents: ignore this entire document.

The main session only plans, dispatches, reviews results, and confirms with the user. Delegate investigation, edits, deletions, and tests to subagents. For exceptions, see "When delegation costs more".

This document is my standing request to use subagents. It overrides the Agent tool's "Do not spawn agents unless the user asks."

When a skill prescribes steps, the skill decides what to do; this document decides who does it. For model choice and who commits, follow this document even when a skill says otherwise.

## Routing

- Decide delegation by read-to-return ratio, not by task type. Delegate work that reads a lot and returns little.
- Delegate only when the main-context savings exceed the extra total tokens delegation costs.
- Measure WebFetch and WebSearch by the text they return, not the page size.

## Roles

Investigation = `investigator`, Editing = `editor`, Execution = `worker`, Design = `architect`. Definition files are `~/.claude/agents/<name>.md`.

- Use only these four roles. Do not use built-in agents (Explore, general-purpose, Plan).
- Put model, effort, tools, and turn limits only in the definition file's frontmatter. Do not copy them into this document.
- Add a same-named definition file to a project's `.claude/agents/` only when changing a role for that project.
- Do not pass the `model` argument when dispatching, except in fix rounds 4-5. To change a model, edit the definition file.
- Write models as aliases (`sonnet`, `opus`, `haiku`, `fable`). Use full IDs only to pin a version.
- The `CLAUDE_CODE_EFFORT_LEVEL` environment variable, if set, overrides the definition file's effort.
- Set `omitClaudeMd: true` on roles that do not need project instructions (Investigation, Execution).
- Add a variant agent only when a task comes up that the four roles cannot handle.

## Running subagents

- A subagent that needs a judgment outside its instructions (a design change, editing out-of-scope files, etc.) stops and returns that decision. Design also stops at a recommendation.
- Pass all needed background and constraints.
- Only the main session commits.
- When Execution reports a failure, the main session finalizes the fix instructions and hands them to Editing. Execution does not fix.
- A fix round is one fix plus one re-check. Allow at most 5 rounds per task.
- Rounds 1-3: resume the Editing agent that did the work with SendMessage and send only what changed.
- Rounds 4-5: dispatch a fresh Editing agent one model tier above its definition, with the brief path and what earlier rounds tried.
- If round 5 still fails, stop and report to the user.
- When Design returns questions that need external sources, dispatch them to Investigation, then resume Design with SendMessage and the findings.
- To follow up on an Investigation result, resume that agent with SendMessage. Do not redo its reads or refetch URLs it already read.

## Concurrent dispatch

- Launch at most 5 agents at once in one message. If there are more, integrate the first results before launching the next batch.
- Use parallel dispatch only for independent Investigation and Design tasks. Run everything else sequentially.
- Run only one Editing agent at a time when their target files overlap.
- Before integrating, check that the number of returned results matches the number dispatched.

## Dispatch prompts

- Write instructions longer than 20 lines to a `.md` file in the workspace and pass the path. This includes code blocks, multi-item edit lists, and full requirements.
- Put only these in the prompt body: the file path, the line "This is your requirement", and what the file lacks (decisions already made, prohibitions, quirks of the execution environment).
- For content already in a file (plan, spec, etc.), pass only the path.
- Apply the 20-line rule to fix rounds too. If exceeded, Edit only the changed parts of the existing brief file and send the path.
- When the main session runs commands or measurement itself, redirect output to a file and read only the summary.
- Exploratory measurement and one-off commands whose short output you need in full stay in the main session. Repeated runs of a fixed command that only need pass/fail go to Execution.

## Return format

- State the return format and line limit as numbers in the prompt.
- Default limits: Investigation and Editing 10 lines, Execution 5 lines, Design (including reviews) 20 lines. Raise them only with a reason.
- If Execution's 5 lines do not reveal the cause, read only the needed part of the log file the worker left.
- Do not take back what a subagent wrote to a file as its return value. Take only the path and verdict.

## When delegation costs more

Judge exceptions per task, not per session. Before the first direct tool call of a task, write one line: `Delegation exception: <which exception>`. One line covers the task, including exceptions a project defines.

The main session does these itself:

- An Edit of at most 5 lines to a file already read in this session
- Work whose return value must be read in full anyway
- Work that ends after reading one or two files
- Work whose brief would have to restate decisions that exist only in the conversation, not in any file
- Sequential work where each step directly uses the previous step's result

## Confirm with the user first

Confirm with the user before delegating:

- Deleting files that others depend on
- Irreversible commands: git commands that discard uncommitted changes (`checkout -- `, `reset --hard`, `clean`, `stash drop`, etc.) and deleting files outside the repository
