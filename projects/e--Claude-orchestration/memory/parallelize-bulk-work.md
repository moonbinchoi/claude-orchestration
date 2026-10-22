---
name: parallelize-bulk-work
description: "User wants bulk parallelizable work (many web searches, multi-source research) dispatched to parallel subagents"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 93c80f96-34b0-4218-8750-e9e729deee3e
  modified: 2026-10-21T18:17:35.818Z
---

When a task contains bulk work that splits into independent pieces (many web searches, multi-source research), dispatch parallel subagents instead of doing it serially.

**Why:** User asked for this explicitly on 2026-10-18 during the global orchestration design ("앞으로의 작업에서 다량의 웹 검색 같은 병렬로 수행 가능한 작업이 있다면 그렇게 해줘").

**How to apply:** Split by independent source or question, one subagent per piece, pin a cheaper model (Sonnet worked well for research), require cited sources, and verify decision-critical claims yourself. See [[global-orchestration-design]].
