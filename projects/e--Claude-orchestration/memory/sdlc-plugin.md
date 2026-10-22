---
name: sdlc-plugin
description: "User's own design-doc plugin (intent/spec/plan skills) — repo location, install mode, where its rationale lives"
metadata:
  node_type: memory
  type: project
  originSessionId: c5089313-95df-47fe-807b-c6da0a9b692b
  modified: 2026-10-22T09:55:36.791Z
---

sdlc plugin built 2026-10-22: own git repo E:\Claude\sdlc-plugin (separate from ~/.claude), installed via local marketplace `sdlc-plugin`. NOT read in place: the Skill tool serves a copy at ~/.claude/plugins/cache/sdlc-plugin/sdlc/<version>/ made at install time, so repo edits need: bump version in .claude-plugin/plugin.json, commit, `claude plugin marketplace update sdlc-plugin`, `claude plugin update sdlc@sdlc-plugin`, restart (verified 2026-10-22, 0.1.0→0.2.0). Remote: private GitHub moonbinchoi/sdlc-plugin, branch master (created 2026-10-22 at user's request). Test runs must read SKILL.md from the repo directly. Skills: write-intents, write-specs, write-plans, write-design-docs. Concept doc with all decisions and sources: E:\Claude\orchestration\docs\design-docs-concepts.md. Routing rule: ~/.claude/rules/design-workflow.md (local only, git-ignored, kept out of the orchestration repo). Decision 2026-10-22: the global orchestration setup and this plugin must stay independent (neither references the other); the routing preference moves into a plugin-shipped SessionStart hook, user's explicit choice of brainstorming wins, and the plugin's scope statements get audited. A new-session prompt for this was written; after it is verified, ask the user before deleting design-workflow.md. See [[orchestration-remote-repo]].

**Why:** user wants it usable in every project, versioned separately, and distributable later (repo is private; ask before making it public).

**How to apply:** edit skills only with superpowers:writing-skills (user requirement); test fixtures were in a session scratchpad and are gone — rebuild a small fixture project for RED/GREEN runs.
