# Stale-resume block Implementation Plan
Status: approved

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1시간 넘게 쉰 큰 메인 세션의 첫 프롬프트를 한 번 막아 만료 캐시 재작성 비용을 피하게 한다.

**Architecture:** 새 모듈 `jev/stale-resume.mjs`가 기록 끝부분에서 직전 메인 assistant 기록을 찾아 공백과 컨텍스트를 판정한다. 기존 훅 진입점 `jev/agent-hooks.mjs`의 UserPromptSubmit 분기가 이 모듈을 main-pick-trigger보다 먼저 부른다. 규칙 파일에는 한 줄을 더한다.

**Tech Stack:** Node.js ESM, `node:assert/strict`, 파일 하나당 테스트 스크립트 하나(`node <name>.test.mjs`).

**Spec:** `C:\Users\skyra\.claude\jev\docs\design\2026-11-07-stale-resume-block\spec.md`

참고: 이 plan을 쓰기 전에 Task 1·2의 코드와 테스트 초안이 이미 작성되어 있다(`jev/stale-resume.mjs`, `jev/stale-resume.test.mjs`, `jev/agent-hooks.mjs`). 실행할 때는 각 task의 테스트 목록과 비교해, 빠진 테스트를 먼저 더하고(실패 확인) 코드를 맞춘다.

## Global Constraints

- 차단 조건: 공백 > 60분, 컨텍스트 > 100,000 토큰, entrypoint `cli`·`claude-vscode`, `CLAUDE_CODE_SESSION_ATTENDED !== '0'`.
- 단가: Opus $8/M, Sonnet $4/M(1시간 캐시 쓰기). 그 밖의 모델은 금액 없이 표시한다.
- fail-open: 어떤 오류든 `null`(막지 않음)이다.
- `settings.json`은 바꾸지 않는다.
- 사용자에게 보이는 `reason`은 한국어다.

## Review Focus

1. 타임스탬프를 해석할 수 없는 assistant 기록이면 막지 않아야 한다 → Task 1 테스트 `unparsable timestamp`.
2. `usage` 필드 일부가 없으면(예: `input_tokens`만 있음) 0으로 쳐서 계산해야 한다 → Task 1 `unknown model` 테스트가 다룬다.
3. 마지막 줄이 메인 기록이 아니어도(user, system 줄) 그 앞의 assistant 기록을 찾아야 한다 → Task 1 `setup`이 마지막에 user 줄을 넣는다.
4. `session_id`에 경로 문자가 들어가면 마커를 만들지 않고 통과해야 한다 → Task 1 테스트 `bad session id`.
5. 2 MB 밖의 assistant 기록은 놓친다. 이것은 spec이 받아들인 한계이므로 `shortcut:` 주석만 남기고 테스트하지 않는다.

---

### Task 1: stale-resume 판정 모듈
Covers: R1, R2, R3, R4, R5, R6, R7, R9

**Files:**
- Create: `jev/stale-resume.mjs`
- Test: `jev/stale-resume.test.mjs`

**Interfaces:**
- Produces: `onPrompt(input, { dir, env = process.env, now = Date.now, reader = readTail }) -> null | { decision: 'block', reason: string }`

- [ ] **Step 1: 테스트 작성.** 기록 픽스처는 Opus, `input 5 + cache_read 190,000 + cache_write 5,000`, `T0 = 2026-11-07T00:00:00Z`이다.
  - `gap over 1 h and context over 100K`:
    - `now = T0 + 61분`이면 `decision === 'block'`이다.
    - `reason`에 `195K`, `$1.56`, `61분`이 들어 있다.
    - 같은 입력을 다시 보내면 `null`이다(R6).
    - `reason`에 "새 세션"과 "다시 보내"가 들어 있다(R5).
  - `a later gap blocks again`: 새 assistant 기록(T0+3h)을 쓴 뒤 `now = T0+5h`이면 다시 block이다(R7).
  - `no block` 표 하나: 다음 경우는 모두 `null`이다(R8 조건, R9).
    - 공백이 정확히 60분이다.
    - 컨텍스트가 90,000이다.
    - sidechain 기록만 있다.
    - `ATTENDED=0`이다.
    - entrypoint가 `sdk-cli`다.
    - 기록 파일이 없다.
  - `unknown model`: Haiku, `input_tokens: 200,000`만 있으면 block이고, `reason`에 `$`가 없다(R4).
  - `unparsable timestamp`: `timestamp: 'x'`이면 `null`이다.
  - `bad session id`: `session_id: '../x'`이면 `null`이다.
- [ ] **Step 2: 실행해서 실패 확인.** `node jev/stale-resume.test.mjs`를 실행하면 새로 더한 테스트가 FAIL이어야 한다.
- [ ] **Step 3: 구현.**
  - `onPrompt`를 Design 그대로 구현한다.
  - 마커 경로는 `<dir>/stale-resume-seen/<sid>-<epoch ms>`이고 `wx`로 만든다.
  - 메시지는 공백(분), `K` 토큰, 금액, 새 세션 제안, 재전송 안내를 담는다.
  - `shortcut:` 주석을 두 개 단다. 하나는 2 MB tail 한계, 다른 하나는 마커를 지우지 않는다는 것이다.
- [ ] **Step 4: 실행해서 통과 확인.** `node jev/stale-resume.test.mjs`를 실행하면 모두 PASS여야 한다.

### Task 2: 훅 진입점 연결
Covers: R8, R9

**Files:**
- Modify: `jev/agent-hooks.mjs`(머리 주석, UserPromptSubmit 분기)
- Test: `jev/stale-resume.test.mjs`(연결 테스트), `jev/agent-hooks.test.mjs`(기존)

**Interfaces:**
- Consumes: Task 1 `onPrompt`.

- [ ] **Step 1: 테스트 작성.** 이름은 `agent-hooks: a stale block wins over main-pick; otherwise main-pick runs`다.
  - 오래된 큰 기록이면 `evaluate()` 출력의 `decision`이 `'block'`이다.
  - 새 세션(assistant 기록 없음)이면 `hookSpecificOutput.additionalContext`에 `main-pick.mjs`가 들어 있다.
  - 기존 `UserPromptSubmit: broken trigger module -> null`이 그대로 통과해야 한다(로더 실패 → null, R9).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
  - UserPromptSubmit 분기에서 `attempt(() => loader('stale-resume.mjs').onPrompt(input, { dir, env, now }))`를 먼저 부른다.
  - 결과가 있으면 그것을 내고, 없으면 기존 main-pick-trigger 결과를 낸다.
- [ ] **Step 4: 통과 확인.** `node jev/stale-resume.test.mjs && node jev/agent-hooks.test.mjs && node jev/main-pick-trigger.test.mjs`를 실행하면 모두 통과해야 한다.
- [ ] **Step 5: Task 1·2 커밋.** `git -C C:/Users/skyra/.claude add jev/stale-resume.mjs jev/stale-resume.test.mjs jev/agent-hooks.mjs`를 실행한 뒤 커밋 메시지 `jev: block the first prompt of a stale large session (stale-resume)`로 커밋한다.

### Task 3: 오케스트레이션 규칙 한 줄
Covers: R10

**Files:**
- Modify: `rules/orchestration.md`("Long work" 절)

- [ ] **Step 1: 줄 추가.** "Long work" 끝에 다음을 넣는다. 사용자 `CLAUDE.md` 작성 규칙(직접 명령형, 자명하지 않을 때만 이유)을 따른다.
  `- When a main session resumes after over an hour idle with a large context, write a status file if none exists and suggest a new session from it.`
- [ ] **Step 2: 확인.** `grep -n "over an hour idle" rules/orchestration.md`를 실행하면 1줄이 나와야 한다.
- [ ] **Step 3: 커밋.** `rules/orchestration.md`를 커밋한다. G3·G4 규칙 수정이 같은 파일에 있으므로 함께 커밋하고, 메시지에 G1·G3·G4를 적는다.

## Final verification

```
cd C:/Users/skyra/.claude/jev && node stale-resume.test.mjs && node agent-hooks.test.mjs && node main-pick-trigger.test.mjs && grep -c "over an hour idle" ../rules/orchestration.md
```
Expected: 모든 줄이 `PASS`/`ok`이고 `N/N passed`가 두 번 나온 뒤 마지막에 `1`이 나온다.

## After implementation

- mattpocock-skills:pr로 변경 설명을 쓴다. Final verification 출력을 Evidence에 넣고 이 폴더를 링크한다. 이 저장소는 사용자가 직접 push하고 PR을 쓰지 않으므로, 설명은 커밋 본문으로 갈음한다.
- 병합 후 intent.md, spec.md, plan.md를 `Status: implemented`로 바꾼다.
