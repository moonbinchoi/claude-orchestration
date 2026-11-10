---
name: knowledge-layer-removed
description: The global setup has no knowledge layer, by user decision; where its archive and eval record live; do not reinstall or propose it
metadata:
  node_type: memory
  type: project
  originSessionId: 40f4909e-3f63-4213-a7ff-5c7cfe2ab0ff
  modified: 2026-11-10T06:34:37.093Z
---

The global setup has no knowledge layer: no `~/.claude/knowledge/`, no `rules/knowledge.md`, no knowledge index lines in analyst/researcher, no knowledge Read allow in settings. Inflearn has no ECC grading tier or `ecc-map.md` and grades against course material only.

Reason: the keep/delete eval (record at `E:/Claude/orchestration/docs/design/2026-10-21-knowledge-layer-eval/`) found ECC community files gave almost no decision-changing content, about 70 sure errors, and 1.6-1.8x token cost. The only decision value came from the user's own `local/` notes.

Archive: `E:/Claude/orchestration/docs/design/2026-10-22-knowledge-layer-removal/` (knowledge.bundle with full history, `local/`, `pending/sources.md`, `inflearn-before/`, `settings-backups/` = old `~/.claude/settings.json.bak-*`). GitHub `moonbinchoi/claude-knowledge` (private, archived read-only) holds every branch plus `records/layer-removal-2026-10-22`.

**Why:** User judged the layer not worth its cost and chose to delete the whole feature.

**How to apply:** Do not reinstall, resume the eval, or propose adding facts to a knowledge layer. To reuse old notes, restore from the bundle or the archived repo on the user's request. Related: [[global-orchestration-design]].
