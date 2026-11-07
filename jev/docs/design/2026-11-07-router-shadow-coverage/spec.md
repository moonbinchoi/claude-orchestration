# Spec: Router shadow coverage
From: intent.md · Status: implemented

용어:
- 규칙 모델: 위임 입력에 `model`이 있으면 그 값이고, 없으면 에이전트 정의 frontmatter의 `model`이다(기존 규칙).
- 하한: analyst와 reviewer는 sonnet이고, 그 밖의 에이전트와 모르는 에이전트는 haiku다(기존 `FLOOR`).
- 라우터 기록: 기존 `router.jsonl`의 `skip`, `jev_model`, `applied_model` 필드다.

## Requirements
- R1 (← G1). WHEN 규칙 모델이 haiku·sonnet·opus 중 하나가 아니고 위임이 아래 R8의 경우에 해당하지 않으면 THE SYSTEM SHALL Jev를 한 번 불러 그 등급을 `jev_model`에 남기고 `skip`=`rule_unknown`으로 기록한다.
- R2 (← G1). WHEN 규칙 모델이 그 에이전트의 하한 이하이고 위임이 R8의 경우에 해당하지 않으면 THE SYSTEM SHALL Jev를 한 번 불러 `jev_model`을 남기고 `skip`=`at_floor`로 기록한다.
- R3 (← G2). WHEN R1 또는 R2로 Jev를 불렀으면 THE SYSTEM SHALL 위임 모델을 바꾸지 않고 `applied_model`을 null로 기록한다.
- R4 (← G1). IF R1·R2의 Jev 호출이 실패하면(시간 초과, HTTP 오류, 응답 검증 실패, 회로 차단 열림) THEN THE SYSTEM SHALL `jev_model`=null, `skip`=`rule_unknown` 또는 `at_floor`로 기록하고 위임을 바꾸지 않는다. 실패 이유는 Jev 자체 로그(`shadow.jsonl`)에만 남는다.
- R5 (← G3). WHEN 작업 폴더나 그 상위 폴더 중 하나에 `.claude/agents/<agent>.md`가 있으면 THE SYSTEM SHALL 작업 폴더에서 가장 가까운 파일의 frontmatter `model`을 규칙 모델로 쓴다. 파일시스템 루트까지 어느 상위 폴더든 일치하면 쓴다.
- R6 (← G3). WHEN R5로 찾은 파일에 frontmatter `model` 줄이 없으면 THE SYSTEM SHALL 규칙 모델을 모름으로 둔다(→ R1).
- R7 (← G3). IF 작업 폴더와 상위 어디에도 그 파일이 없으면 THEN THE SYSTEM SHALL `~/.claude/agents/<agent>.md`의 model을 쓰고, 그것도 없으면 모름으로 둔다.
- R8 (← Non-goals). WHEN 위임에 `Summary:` 줄이 없거나(`no_summary`), `Model-lock:` 줄이 있거나(`model_lock`), `model`=fable이거나(`fable`), 에이전트가 fork이거나(`fork`), 요약이 민감 단어 목록에 걸리면(`sensitive`) THE SYSTEM SHALL Jev를 부르지 않고 괄호 안의 값을 `skip`으로 기록한다. 민감 위임은 규칙 모델을 모르거나 하한 이하여도 `sensitive`로 기록한다.
- R9 (← Non-goals). WHEN 규칙 모델이 하한보다 높고 R8에 해당하지 않으면 THE SYSTEM SHALL 기존 라우터 판단을 유지한다:
  - Jev 등급이 더 낮으면 위임 모델을 그 등급으로 내린다.
  - 같거나 높으면 `skip`=`not_lower`로 기록한다.
  - Jev 호출이 실패하면 `skip`=`jev: <이유>`로 기록한다.
- R10 (← fail-open 제약). IF 에이전트 파일 탐색이나 라우터 처리 중 오류가 나면 THEN THE SYSTEM SHALL 위임을 바꾸지 않는다.

## Design
- 대상은 `jev/router-guard.mjs` `onDispatch`다. 판정 순서:
  1. `no_summary` → `model_lock` → `fable` → `fork` → `sensitive`. 여기서 걸리면 끝낸다.
  2. 규칙 모델을 모르면 shadow=`rule_unknown`, 하한 이하면 shadow=`at_floor`로 둔다.
  3. Jev는 한 경로로만 부른다. shadow가 있으면 `skip`=shadow로 끝낸다(출력 없음).
- 지금 코드는 `rule_unknown`을 `sensitive`보다 먼저 본다. 그래서 규칙 모델을 모르는 민감 위임의 `skip`이 `rule_unknown`에서 `sensitive`로 바뀐다(사용자 승인 2026-11-07).
- Jev 호출은 기존과 같다.
  - `jev-tier.mjs` `run`을 시간 한도 1초로 부르고, 보내는 텍스트는 `Summary:` 줄뿐이다. `rule_model`은 모를 때 null이다.
  - 하한은 `run` 안에서 적용되므로 reviewer/analyst의 `jev_model`은 sonnet 아래로 내려가지 않는다. 하한 적용 전 원값은 `run`이 이미 `shadow.jsonl` `jev_raw`에 쓴다.
- 탐색: `path.resolve(cwd)`에서 `dirname`으로 루트까지 올라간다. 각 폴더에서 `agentModel(<dir>/.claude/agents, name)`을 부른다.
  - 결과가 `undefined`(파일 없음)가 아닌 첫 값을 쓴다. `null`(model 줄 없음)도 결과로 친다.
  - 끝까지 `undefined`면 사용자 에이전트 폴더로 넘어간다.
  - `agentModel`은 읽기 실패를 `undefined`로 돌려준다. 그 밖의 오류는 진입점의 기존 `attempt`(예외 → 출력 없음)가 흡수한다.
- Test seams: `onDispatch`에 `fetchImpl`(가짜 Jev 응답), `dir`, `agentsDir`, `input.cwd`를 주입하고 반환값과 `router.jsonl`을 본다.

## Alternatives
- Do nothing: 위임의 약 44%(25건 중 11건)가 섀도 평가에서 빠진다.
- `CLAUDE_PROJECT_DIR` 환경 변수로 프로젝트 폴더 찾기: 훅 프로세스에 항상 있는지 확인되지 않았다. 상위 탐색이 이 경우도 덮는다.
- 규칙 모델을 모르는 민감 위임을 `rule_unknown`으로 두고 Jev만 부르지 않기: 판정 분기가 하나 더 생긴다. 기록값만 다를 뿐 동작은 같다.
- `sensitive`·`model_lock`도 섀도 호출: intent의 Non-goal이다.
