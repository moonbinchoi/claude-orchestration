---
name: jev
description: Use when the user asks to have Jev judge something, via `/jev <request>` or in plain words such as "ask Jev".
disable-model-invocation: true
---

# Jev

Jev is a fast classifier API. It answers closed questions with probabilities. This skill runs in the main conversation only. Reply to the user in Korean.

Question design (types, wording, state, reading answers): read `C:/Users/skyra/.claude/jev/docs/jev-usage.md` before writing the request.

## Before writing anything

- The judgment needs raw Korean text, code, paths, or secrets (a summary would remove what is being judged): write no request, run no CLI, and tell the user why Jev cannot judge it. Sending "a sanitized English summary instead" is the wrong move: the summary is a different judgment.
- The request is a fact check, a count, or multi-step reasoning: add one warning line to the user that Jev is weak at this, then still send it. Answering it with code instead is the wrong move: the user asked for Jev.

## Steps

1. Make each thing to judge one question: Choice (pick one option), Score (a level on a scale), or Noul (yes/no probability).
2. Write the state as English fields holding what the item observably is or did (files touched, counts, the change in the user's own facts). A field that restates or paraphrases an option's description hands Jev the answer: for a feature-vs-bugfix choice, `adds_new_user_facing_capability: true` and `behavior_change: "users gain a new export action"` are the wrong move; `files_changed: 3` and `title_verb: "add"` are facts.
3. Use option IDs you choose. When no option may fit, add a companion Noul ("one of the options fits").
4. Write the request file and run the CLI (below). Send without asking the user for confirmation.
5. Read the output (below). When it is unsure, fall back to your own judgment.
6. Report (below).

## Request file

Write it with the Write tool into the session scratchpad, then run once (one re-run only after `input_rejected`, which makes no Jev call):

`node C:/Users/skyra/.claude/jev/jev-ask.mjs "<file>"`

```json
{ "items": [
  { "id": "pr_1",
    "state": { "word_count": 412, "audience": "reviewers" },
    "questions": {
      "length": { "type": "choice", "instructions": "Pick whether the description should be kept or shortened.", "criteria": { "keep": "...", "shorten": "..." } },
      "length_fits": { "type": "noul", "instructions": "One of the options keep or shorten fits this case." } },
    "companions": { "length_fits": "length" } } ] }
```

- One item per thing being judged, each with its own state and questions. Put no fact of one item in another item.
- Rewrite a Korean request as fresh English questions and named state fields. Translate no sentence.
- Limits: items 1-10; questions per item 1-10; state fields 1-20 (string, number, or boolean values); criteria 2-10 per question (Choice: key to description; Score: ordered list, level 0 first; Noul: none). IDs match `^[a-z][a-z0-9_]{0,39}$`. English only.
- Put no paths, URLs, emails, secrets, long hex, or numbers of 4+ digits inside strings. Pass numbers as number values.
- On `Jev failed: input_rejected: <rule>` (with or without ` at <where>`), fix your request and run once more; report a second rejection as a failure.

## Reading the output

One line per question, items in order:

- Choice: `Jev <item>.<q>: <top> 0.62 (<second> 0.30)`
- Score: `Jev <item>.<q>: score 1.62, level 2 0.58 (level 1 0.31)`
- Noul: `Jev <item>.<q>: p 0.82 yes` (p >= 0.70 yes, <= 0.30 no, between: `noul_band`)
- Companion Noul: `Jev <item>.<q>: p 0.55 companion of <target>`
- Marks: `; unsure: low_p` (top below 0.60), `noul_band`, `no_option_fits` (companion p below 0.70), `companion_missing`.
- Failures: `Jev failed: <reason>` (whole run) or `Jev <item> failed: <reason>` (one item).

## Report

In Korean, in this order:

1. Per question: Jev's top answer with its probability, and the runner-up.
2. The questions and state that were sent.
3. A one-line interpretation.

Quote Jev's printed lines. Report only what Jev printed; a conclusion Jev did not print (such as "Jev agrees") is not a result.

When a line has `unsure:` or any failure line appears: write `Jev가 판단하지 못함` with the reason, then add your own judgment in a separate part labelled `Claude의 판단`. Keep Jev's answer and your judgment apart.

## After the report

Stop and wait for the user. Make no tool call and no dispatch based on Jev's answer, even when the user's original request implied a follow-up action.
