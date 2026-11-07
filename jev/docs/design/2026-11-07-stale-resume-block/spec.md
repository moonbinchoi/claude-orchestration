# Spec: Stale-resume block
From: intent.md · Status: implemented

## Requirements
- R1 (← G1). WHEN 사람이 보는 대화형 세션에서 프롬프트를 보내고, 직전 메인 assistant 기록으로부터 60분 넘게 지났고, 그 기록의 컨텍스트 토큰(input + cache read + cache write)이 100,000을 넘으면 THE SYSTEM SHALL 그 프롬프트를 모델로 보내지 않고 막는다.
- R2 (← G1). WHEN R1로 막을 때 THE SYSTEM SHALL 예상 재작성 토큰(= R1의 컨텍스트 토큰, 천 단위 반올림 K)을 보인다.
- R3 (← G1). WHEN R1로 막고 직전 기록의 모델이 Opus 또는 Sonnet이면 THE SYSTEM SHALL 예상 금액(컨텍스트 토큰 × 1시간 캐시 쓰기 단가: Opus $8/M, Sonnet $4/M, 소수 둘째 자리)을 보인다.
- R4 (← G1). IF 직전 기록의 모델이 Opus도 Sonnet도 아니면 THEN THE SYSTEM SHALL 금액 없이 토큰 수만 보인다.
- R5 (← G1). WHEN R1로 막을 때 THE SYSTEM SHALL 상태 파일에서 새 세션을 시작하라는 제안을 보인다.
- R6 (← G2). WHEN 같은 세션에서 같은 직전 assistant 기록 뒤로 이미 한 번 막았으면 THE SYSTEM SHALL 다음 프롬프트를 막지 않는다.
- R7 (← G2). WHEN 그 뒤 새 assistant 기록이 생기고 다시 R1 조건을 만족하면 THE SYSTEM SHALL 다시 한 번 막는다.
- R8 (← G3). IF R1 조건 중 하나라도 맞지 않으면 THEN THE SYSTEM SHALL 막지 않고, 훅 출력은 이 변경 전과 같다(첫 프롬프트의 시작 모델 추천 포함).
- R9 (← G3, fail-open 제약). IF 기록 파일이 없거나 읽을 수 없거나, 메인 assistant 기록이 없거나, 처리 중 오류가 나거나, 훅이 4초 한도를 넘기면 THEN THE SYSTEM SHALL 프롬프트를 막지 않는다.
- R10 (← G4). THE SYSTEM SHALL `rules/orchestration.md` "Long work"에 1시간 넘게 쉰 큰 메인 세션은 이어가지 말고 상태 파일에서 새 세션을 시작하라는 한 줄을 둔다.

## Design
- 새 모듈 `jev/stale-resume.mjs`: `onPrompt(input, { dir, env, now, reader })`.
  - `dir`: Jev 디렉터리(`~/.claude/jev`).
  - `env`: 환경 변수 객체(기본 `process.env`).
  - `now`: epoch ms를 돌려주는 함수.
  - `reader(path, maxBytes)`: `{ text }`를 돌려주는 함수(기본 `transcript-read.mjs` `readTail`).
  - 반환값: `null` 또는 `{ decision: 'block', reason }`. 이것은 Claude Code의 UserPromptSubmit 차단 형식으로, API 호출 전에 프롬프트를 지우고 `reason`은 사용자에게만 보인다.
- "사람이 보는 대화형 세션": `env.CLAUDE_CODE_ENTRYPOINT`가 `cli` 또는 `claude-vscode`이고 `env.CLAUDE_CODE_SESSION_ATTENDED`가 `'0'`이 아닌 경우다. 기존 main-pick-trigger와 같은 기준이며, 다른 entrypoint(SDK 등)는 일부러 제외한다.
- 입력은 hook stdin의 `session_id`, `transcript_path`다. 기록은 끝 2 MB만 읽는다. 끝에서부터 `type: 'assistant'`, `isSidechain !== true`, `message.usage`, `timestamp`를 모두 갖춘 첫 줄을 쓰고, 잘린 첫 줄처럼 JSON이 아닌 줄은 건너뛴다.
  - 컨텍스트 = `usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens`이고, 없는 필드는 0으로 친다.
  - 한계: 직전 assistant 기록이 끝 2 MB 밖에 있으면 막지 않는다. 코드에 `shortcut:` 주석으로 남긴다.
- 모델 판별: `message.model` 문자열에 `opus` 또는 `sonnet`이 들어 있는지 본다.
- 메시지(한국어)에는 공백(분), R2~R5 내용, 같은 프롬프트를 다시 보내면 진행된다는 안내가 들어간다. 공백과 재전송 안내는 R6의 동작을 사용자에게 알리기 위한 설계 선택이다.
- 한 번만 막기: `<dir>/stale-resume-seen/<session_id>-<직전 기록 epoch ms>` 빈 파일을 `wx` 플래그로 만든다.
  - 이미 있거나 다른 이유로 만들지 못하면 막지 않는다.
  - `session_id`가 `[A-Za-z0-9_-]+`가 아니면 막지 않는다.
  - 마커는 지우지 않는다(`shortcut:` 주석).
- 연결: `agent-hooks.mjs` `evaluate()`의 UserPromptSubmit 분기에서 stale-resume을 먼저 부른다. 차단이면 그 결과만 내고, 아니면 기존대로 main-pick-trigger 결과를 낸다. 두 호출 모두 기존 `attempt` 래퍼(예외 → null)로 감싼다.
- `settings.json`은 바꾸지 않는다. 같은 진입점이 이미 UserPromptSubmit에 등록되어 있다.
- 4초 한도는 진입점의 기존 자체 종료 타이머가 지킨다. 종료되면 출력이 없으므로 막지 않는다.
- Test seams:
  - `onPrompt`에 `reader`/`now`/`env`/`dir`를 주입하고 반환값을 본다.
  - 연결은 `evaluate()`에 UserPromptSubmit 입력을 넣고 output JSON을 본다.

## Alternatives
- Do nothing: 재개할 때마다 Opus 기준 ~$1~1.5가 예고 없이 나간다.
- 경고만(차단 없음): 경고가 보일 때는 이미 재작성이 끝나서 첫 비용을 막지 못한다. 사용자가 차단을 골랐다.
- 세션당 한 번만 막기: 여러 번 쉬는 긴 세션에서 두 번째 재개를 놓친다.
- 별도 훅 스크립트를 `settings.json`에 등록: 같은 이벤트의 진입점이 둘이 되고, 사용자 소유 설정 파일을 건드린다.
