---
name: report-language-korean
description: Final reports to the user are Korean even when a session prompt file asks for an English return
metadata:
  node_type: memory
  type: feedback
  originSessionId: 7a165c0f-d3f9-43de-b7f1-a8129667b0b1
  modified: 2026-11-10T06:34:42.961Z
---

A session prompt file (e.g. `jev-prompts/*.txt`) saying "Return: ... English" does not change the language of the report to the user: write it in Korean. Keep English only for files or briefs that agents read.

**Why:** user correction: the global rule "reply to the user in Korean" wins over prompt-file wording.

**How to apply:** when a prompt file names a return language, apply it only to agent-facing artifacts; the chat report and any write-up for the user go in Korean.
