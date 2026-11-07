# Router shadow coverage Implementation Plan
Status: implemented

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라우터가 `rule_unknown`·`at_floor` 위임에서도 Jev 등급을 섀도로 기록하고, 프로젝트 하위 폴더에서도 프로젝트 에이전트 모델을 찾게 한다.

**Architecture:** `jev/router-guard.mjs` `onDispatch`의 판정 순서를 바꾼다. sensitive를 먼저 보고, 그다음 shadow 사유를 정한다. Jev는 한 경로로만 부른다. 에이전트 정의 탐색은 cwd에서 루트까지 올라간다.

**Tech Stack:** Node.js ESM, `node:assert/strict`, `node jev/router-guard.test.mjs`.

**Spec:** `C:\Users\skyra\.claude\jev\docs\design\2026-11-07-router-shadow-coverage\spec.md`

참고: Task 1·2의 코드와 일부 테스트 초안은 이 plan보다 먼저 작성되었다(`jev/router-guard.mjs`, `jev/router-guard.test.mjs`). 실행할 때는 각 task의 테스트 목록과 비교해, 빠진 테스트를 먼저 더하고 코드를 맞춘다.

## Global Constraints

- Jev 시간 한도는 1초이고, 보내는 텍스트는 `Summary:` 줄뿐이다.
- 하한: analyst·reviewer는 sonnet, 그 밖은 haiku다(기존 `FLOOR`).
- 섀도 결과는 위임 입력을 바꾸지 않는다. 출력은 `null`이고 `applied_model`도 null이다.
- `router.jsonl` 필드는 그대로다.

## Review Focus

1. 섀도 호출의 Jev가 실패해도(HTTP 500) 위임이 그대로여야 한다 → Task 2 테스트 `shadow Jev failure`.
2. 규칙 모델을 모르는 민감 위임은 Jev를 부르지 않아야 한다 → Task 2 `skips` 테스트의 추가 루프.
3. cwd가 상대 경로여도 탐색이 동작해야 한다 → `resolve(cwd)`. Task 1 테스트는 절대 경로만 쓰므로 여기서 짚기만 한다(Claude Code는 cwd를 절대 경로로 준다).
4. 가장 가까운 프로젝트 파일에 model 줄이 없으면 상위로 더 올라가지 않아야 한다 → Task 1 기존 테스트 `model line outside the frontmatter`.
5. cwd가 없으면(필드 누락) 사용자 에이전트로 넘어가야 한다 → 기존 테스트들이 cwd 없이 돈다.

---

### Task 1: 상위 폴더 탐색
Covers: R5, R6, R7, R10

**Files:**
- Modify: `jev/router-guard.mjs`(`ruleTierOf`, 새 `projectModel`, `node:path` import)
- Test: `jev/router-guard.test.mjs`

**Interfaces:**
- Produces: 내부 함수 `projectModel(dir: string, name: string) -> string | null | undefined`. `undefined`는 어디에도 파일이 없다는 뜻이다.

- [ ] **Step 1: 테스트 작성.**
  - `project agent is found from a project subfolder`: `proj/.claude/agents/source-reader.md`(model opus), cwd `proj/projects/shop`이면 `router.jsonl` 마지막 줄의 `rule_model === 'opus'`다.
  - 기존 `project agent overrides the user agent`: 프로젝트 sonnet이면 `rule_model === 'sonnet'`이다. model 줄이 없는 파일이면 `skip === 'rule_unknown'`이다(R6).
  - 기존 테스트들은 cwd 없이 사용자 에이전트를 쓴다(R7).
- [ ] **Step 2: 실패 확인.** `node jev/router-guard.test.mjs`를 실행하면 subfolder 테스트가 FAIL이어야 한다.
- [ ] **Step 3: 구현.** `projectModel(resolve(cwd), name)`는 `dirname(dir) === dir`(루트)이 될 때까지 재귀하고, `undefined`가 아닌 첫 결과를 돌려준다.
- [ ] **Step 4: 통과 확인.**

### Task 2: 섀도 호출
Covers: R1, R2, R3, R4, R8, R9, R10

**Files:**
- Modify: `jev/router-guard.mjs`(`onDispatch` 판정부)
- Test: `jev/router-guard.test.mjs`, `jev/agent-hooks.test.mjs`(기존 `broken router module is ignored`, R10)

**Interfaces:**
- Consumes: `jev-tier.mjs` `run`, `FLOOR`(변경 없음).

- [ ] **Step 1: 테스트 작성.**
  - `rule unknown: Jev is called in shadow and logged, never applied`: `subagent_type`이 `odd`(model inherit)와 `nofile`인 두 경우를 본다.
    - 출력은 `null`이고 `f.calls >= 1`이다.
    - 기록은 `skip === 'rule_unknown'`, `jev_model === 'haiku'`, `applied_model === null`이다.
  - `rule tier at the floor: Jev in shadow, never applied`: worker(haiku)는 `jev_model 'haiku'`, analyst+`model: sonnet`은 `jev_model 'sonnet'`(하한)이다. 둘 다 `skip === 'at_floor'`이고 출력은 `null`이다.
  - `shadow Jev failure`: worker, fetch가 HTTP 500을 돌려주면 출력은 `null`이고 기록은 `skip === 'at_floor'`, `jev_model === null`이다(R4).
  - `skips make no Jev call`: 기존 다섯 사유(`no_summary`, `model_lock`, `fable`, `fork`, `sensitive`)는 `f.calls === 0`이다. 여기에 루프를 하나 더한다. `odd`·`worker`에 민감 요약이면 `f.calls === 0`이고 `skip === 'sensitive'`다(R8).
  - 기존 lowering, `not_lower`, `Jev failure: no output` 테스트는 그대로 통과해야 한다(R9).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
  - 판정 순서는 spec Design 1~3을 따른다.
  - `if (shadow) rec.skip = shadow;`를 Jev 결과 해석의 첫 분기로 둔다.
- [ ] **Step 4: 통과 확인.** `node jev/router-guard.test.mjs && node jev/agent-hooks.test.mjs`를 실행하면 모두 통과해야 한다.
- [ ] **Step 5: 커밋.** `jev/router-guard.mjs`, `jev/router-guard.test.mjs`, 이 설계 폴더를 커밋 메시지 `jev: router shadow-logs Jev on rule_unknown and at_floor; find project agents from subfolders`로 커밋한다.

## Final verification

```
cd C:/Users/skyra/.claude/jev && node router-guard.test.mjs && node agent-hooks.test.mjs && for t in *.test.mjs; do node $t >/dev/null 2>&1 || echo "FAIL $t"; done; echo suite-done
```
Expected: 모든 줄이 `PASS`/`ok`이고, `FAIL` 줄 없이 `suite-done`이 나온다.

## After implementation

- mattpocock-skills:pr로 변경 설명을 쓴다. Final verification 출력을 Evidence에 넣고 이 폴더를 링크한다. 이 저장소는 PR 없이 사용자가 push하므로 커밋 본문으로 갈음한다.
- 병합 후 intent.md, spec.md, plan.md를 `Status: implemented`로 바꾼다.
- 다음 재측정 때 `router.jsonl`에서 `skip`이 `rule_unknown`·`at_floor`인 줄에 `jev_model`이 채워졌는지 확인한다.
