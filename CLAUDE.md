## Writing rules

When writing rules or instructions:

- Write direct, concise imperatives.
- Add a one-line reason only when the rule is not self-evident.
- For each line, ask whether deleting it would change behavior. If not, delete it.
- Do not state what the model already knows.

## Answering

- If the given information cannot support a conclusion, do not guess. Say so directly and state exactly what is missing.
- Reply to the user in Korean, regardless of the input language.
- Write in English whatever only Claude or another agent reads: thinking, subagent briefs and reports, scratch notes, memory files. A subagent's reader is the agent that dispatched it, so a subagent writes in English.

## Unconfirmed decisions

Mark each decision the user did not make with `Claude 결정(미확인)` at the end of its line (in a table, the end of the cell). Apply it in designs, test plans, prompts, briefs, and rule files. Do not apply it in replies, notes, code comments, or sdlc stage documents (intent.md, spec.md, plan.md), which the user approves in their own stage. Ignore the marker text that defines this rule.
- A decision is a choice that does not follow directly from the user's request or an approved document and would change the result if made differently. Typos and formatting are not decisions.
- Do not ask about a marked decision while writing. In the completion report, list every mark in the documents you wrote or edited as `file:line — decision`, and ask the user to confirm.
- A subagent that marks a decision lists it the same way in its report. Merge subagent lists into the completion report.
- Confirmed: remove the mark, keep the text. Rejected: replace with the user's alternative, or delete the decision and any text that only carried it. Unanswered: keep the mark.
