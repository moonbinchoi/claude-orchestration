# Jev evidence

Sources behind [jev-usage.md](jev-usage.md). Full digests (2026-10-22): `E:\Study\Inflearn\docs\research\global-orchestration\jev-research-2026-10-22\` (R1 official docs, R2 community, R3 literature, R4 hook practice, 00-synthesis). Our shadow analysis: `E:\Study\Inflearn\docs\research\global-orchestration\shadow-review-2026-10-22\`.

Verified by main against the source: confidence formula (110 router rows), Vals AI figures, limpet figures. Everything else is researcher-reported; several pages were read as fetch summaries.

## Official docs (https://docs.typesafe.ai/)
- Question types and the "act on directly" rule: primitives.md, primitives/choice.md, score.md, noul.md, advanced.md.
- Failure modes (literal reading, first-option bias, indirection, irrelevant state, contradiction, state not hostile): model-jaggedness/jev-1.13.md. No 1.14 page exists (404).
- Confidence formula, illustrative thresholds: confidence.md; patterns/confidence-routing.md; cookbooks consistency_choice (91% agreement, 99% with abstain < 0.60) and consistency_noul (0.30/0.70 band).
- Pair and evidence recipes: cookbooks/entity_alignment.md (3-level Score), citation_check.md (supports/contradicts/says_nothing, string match first), classifying_rag_passages.md, sde_cascade.md.
- Versions, price, limits: models.md, api/errors.md, legal.md (ZDR enterprise only).
- Question types incl. Box (2026-11-07 digest `E:\Study\Inflearn\docs\research\global-orchestration\jev-research-2026-11-07\R5-question-types.md`): primitives/box.md (read by main: no criteria, edges 0-1 from top-left, no "not found" answer, pair with Noul, Dreamer-ready, header per request), images.md, changelog.md (Box new in 1.14, 2026-10-14), cookbooks feeder_watch and ocr_confidence_bounding_boxes. `jev-latest` resolves to jev-1.14.0 (doctor, 2026-11-07). Unverified: Box confidence nullable (box.md does not say), Box returning 400 on 1.13 (LiteLLM snippet only).

## Independent tests
- Vals AI, 2026-10-06, https://www.vals.ai/blogs/independent-evaluation-of-jev : claim verification 0.975 (390/400), ECE 0.011 lowest of 12; LegalBench class-balanced 0.730, last of 12, ECE 0.108 highest; confidence "adds no additional signal"; 33/33 "Yes" on contract_nli_permissible_copy; median latency 0.10 s.
- limpet, https://github.com/noplan-inc/limpet : Jev Stop hook, 2,645 human-replied stops, AUROC 0.60-0.62 per rule, 5-12% caught at 5% false positives, author's ceiling about 0.65, "a cheap nudge, not a wall".
- OpenRouter Banking77 (R2): Jev 81.0% vs Opus 84.4%; 96.3% accurate at confidence >= 0.99, 29.6% below 0.5.

## Community projects (R2)
- Routers that raised top-tier gates or moved to deterministic selectors: blablanumerodeux/model-router (strong share 26.7% -> 6.7%), suenot/codex-jev-router.
- gargpratyush/jev-router: issue #72 decision hijacking, PR #65 state steering 6/6, #59 3 s deadline pins Opus, #49 never downgrades.
- jevwire `# jev:intended <reason>` marker for intentional repeats.

## Literature (R3)
- Routing collapse toward expensive models: arXiv 2602.03478. Prompt-only routers close 7.5-14.4% of the oracle gap: 2608.08265. RouteLLM needs in-distribution labels.
- Replay of agent runs on another model is invalid (about 3% of states valid): 2608.08239. Use fresh paired runs with a held-out baseline.
- Small judges need the evidence text (MiniCheck). Position bias and permutation fixes: MT-Bench paper, 2305.17926, 2309.03882.

## Hook practice (R4)
- Anthropic /goal: prompt-based Stop hook that skips while a subagent or background shell runs.
- attest (git delta at SubagentStart/Stop + structured handoff), groundtruth (regex claims vs tool calls), OpenHands stuck detector (3 identical errors).

## Our shadow log 2026-10-19..21
- Router: Jev lower 7 / equal 57 / higher 42 vs rule; confidence = function of p_max; 4 invalid_response.
- stop-guard 18/18 false; dispatch-guard 5/5 false (intentional repeats), same_task "no" 55/55 right; report-level Jev 4 of 5 gate-passers wrong; claim pairs 45 of 47 gate-passers cannot_tell on placeholder evidence.
