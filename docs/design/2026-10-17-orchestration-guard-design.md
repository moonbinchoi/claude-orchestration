# 오케스트레이션 가드 훅 재설계

## 의도

1차 목표는 메인 세션이 ORCHESTRATION.md를 **더 엄격하게** 지키는 것이다. 엄격함은 규칙을 **명확하게** 적용해서 얻는다: 가드와 문서가 같은 규칙을 말하고, 위반 신호는 행동을 바꿀 주체(Claude)에게 간다.

현재의 새는 곳:
- 확인(ask) 창이 사용자에게 간다. 지난 15건 모두 승인됐고 Claude는 피드백을 받지 못했다.
- `Delegation exception:` 뒤에 무엇을 써도 통과하고, 한 줄이면 그 사용자 메시지 끝까지 직접 호출이 무제한이다.
- 가드는 호출 횟수(8회)를 센다. 문서에는 8이 없고, 실제 비용은 횟수가 아니라 메인 맥락에 오간 양이다.
- git 면제·작은 Edit 면제는 가드에만 있다. `cd x && git ...`은 면제되지 않는다.
- 문서는 "per task", 가드는 사용자 메시지 단위다.

## 근거 데이터 (지난 세션 기록 측정)

- 서브에이전트 고정 시작 비용: 역할별 첫 턴 맥락 6~11K 토큰(investigator·haiku 6~8K, editor·sonnet 11.5K, architect·opus 10.4K). 위임 시 메인에 들어오는 양은 지시문+반환 ≈ 1K 토큰 안팎.
- 메인 직접 호출 4,290건의 메인 맥락 비용 비중: Bash 71%, Read 20%, 나머지 각 2% 이하. Bash 중 47%는 `cat/head/sed` 파일 읽기, 15%는 `grep/find/ls`, git 7%.
- Grep/Glob만 Haiku에 무조건 위임: 결과를 그대로 받으면 +32% 손해, 300토큰으로 줄여 받아도 87묶음 중 29개에서만 이득. 묶음당 Grep 중앙값 1개라 모아 보낼 기회가 거의 없다. → 도구 종류 규칙은 채택하지 않는다.
- 기준값 보정(직접 호출 구간 844개): 글자 수 기준 10,000자를 넘는 구간 212개 vs 현행 9회 이상 130개. 10,000자는 횟수는 적지만 큰 결과를 끌어온 구간 98개를 새로 잡고, 9회 이상이지만 싸게 끝난 구간 16개만 놓아준다.

## 목표

- 가드가 문서에 적힌 규칙만 강제한다. 문서에 없는 면제는 없다.
- 예산은 호출 횟수가 아니라 직접 작업으로 오간 글자 수다.
- 예산 초과 시 Claude의 호출을 거부(deny)하고, 무엇을 하면 되는지 사유에 적는다.
- 예외 줄은 문서에 정의된 ID 하나를 대야 유효하다. 한 줄은 새 예산 한 번을 연다(무제한 아님).

## 비목표

- 도구 종류별 금지(Grep/Glob 위임 강제).
- 예외 ID별 행동 한도 검사(Rust `#[expect]`식). 예외 줄이 연 구간도 같은 예산으로 묶이므로 이번에는 넣지 않는다.
- 프로젝트별 예외 ID 정의. 지금 쓰는 프로젝트가 없다.

## 반목표 (기술적으로 돌아가도 실패)

- 사용자에게 확인 창이 다시 뜬다.
- 가드 버그로 세션이 막힌다(실패 시 통과 원칙 유지).
- 문서와 가드가 다른 규칙을 말한다.

## 제약

- `~/.claude/`, 프로젝트 `.claude/` 수정은 메인 세션이 Edit 도구로 한다. 서브에이전트는 auto 모드 분류기에 "Self-Modification"으로 거부된다.
- 규칙 문구는 지워도 행동이 안 바뀌는 줄을 넣지 않는다.

## 결정된 동작

### 예산
- **단위:** 직접 도구의 입력 글자 수(`tool_use.input`의 JSON 길이) + 결과 글자 수(`tool_result` 텍스트 길이)의 합. 결과의 이미지·문서(PDF) 블록은 블록당 3,000자로 센다(메인 맥락 비용은 실재하지만 base64 길이는 그 비용과 무관하므로 고정값. 작성자 판단, 조정 가능).
- **직접 도구:** Read, Grep, Glob, Edit, Write, NotebookEdit, Bash, PowerShell, WebFetch, WebSearch (현행과 같음).
- **구간 시작:** 현재 사용자 메시지의 시작, 마지막 위임(Agent, SendMessage), 마지막 유효 예외 줄 중 가장 늦은 것.
- **한도:** 10,000자. 구간 누적이 한도 이상이면 다음 직접 호출을 거부한다. 한도를 넘기는 그 호출 자체는 결과 크기를 미리 알 수 없으므로 통과한다.
- **면제:** `~/.claude/` 또는 `<프로젝트>/.claude/` 아래 파일에 대한 Edit/Write/NotebookEdit는 세지도 않고, 예산을 넘은 뒤에도 거부하지 않는다(현행 작은 Edit 면제처럼 아예 건너뛴다). 이유: 서브에이전트가 할 수 없다. 이 면제는 문서에도 적는다.
- **삭제하는 면제:** git 명령 면제, 이미 읽은 파일의 5줄 이하 Edit 면제. 둘 다 결과가 작아 글자 수 예산에서 자연히 싸다. `git diff`처럼 큰 출력은 세는 것이 맞다.

### 예외 줄
- 형식: `Delegation exception: <id> -- <task>`. assistant 텍스트 어디든, 현재 사용자 메시지 안에서.
- ID 목록은 `~/.claude/ORCHESTRATION.md`의 "When delegation costs more" 절에서 읽는다: 그 절의 `` - `id`: `` 로 시작하는 목록 항목. 파일을 못 읽거나 ID가 0개면 실패 시 통과(현행 예외 줄 동작: 접두사만 맞으면 유효).
- ID가 목록에 없으면 그 줄은 무효다(예산을 열지 않는다). 거부 사유에 유효 ID 목록을 적는다.
- 유효한 줄은 그 지점에서 새 구간을 시작한다.

### 거부 신호
- PreToolUse 출력 `permissionDecision: "deny"`, `permissionDecisionReason`(Claude에게 보임) 예:
  `ORCHESTRATION.md: 10,412 chars of direct work since the last delegation (budget 10,000). Delegate the rest, or write "Delegation exception: <id> -- <task>" (ids: small-edit, read-anyway, few-files, conversation-only, sequential) and retry.`
- 무효 ID가 이번 구간에 있었다면 사유 끝에 `"<쓴 id>" is not a valid id.`를 붙인다.
- ask 모드와 명령줄 인자(`ask|deny`)는 없앤다.

### Stop 훅 제거
- PreToolUse가 초과 다음 호출을 거부하므로, Stop 단계에서 사후에 예외 줄을 요구할 이유가 없다. Stop 처리 코드와 settings.json의 Stop 등록을 지운다.
- 스크립트는 `hook_event_name !== 'PreToolUse'`이면 아무것도 출력하지 않는다. settings.json(현재 PreToolUse·Stop 모두 `ask` 인자)과 스크립트는 같은 단계에서 고친다.

### 상태 저장
- 구간 계산은 transcript(`input.transcript_path`)만으로 한다: 현재 `prompt_id`의 첫 항목 이후의 assistant `tool_use`, user `tool_result`, assistant 텍스트를 순서대로 훑는다. 임시 폴더의 세션별 jsonl 로그(`os.tmpdir()/claude-orch-guard`)는 없앤다.
- transcript를 못 읽으면 통과한다.

### 유지
- 서브에이전트 호출(`input.agent_id`) 통과.
- ORCHESTRATION.md를 import한 프로젝트에서만 활성(`enabled(cwd)`).
- 예외 발생 시 통과(fail open).

## 문서 변경 (ORCHESTRATION.md "When delegation costs more" 절 교체안)

```markdown
## When delegation costs more

The main session may work directly up to 10,000 characters of tool input plus output since the latest of: the user's message, a delegation (Agent, SendMessage), or a valid exception line. Edits and writes under `~/.claude/` or `.claude/` do not count, because subagents cannot make them.

Past that, delegate, or write `Delegation exception: <id> -- <task>` and continue. A valid line starts a new budget. The guard hook denies direct calls past the budget.

- `small-edit`: An Edit of at most 5 lines to a file already read in this session
- `read-anyway`: Work whose return value must be read in full anyway
- `few-files`: Work that ends after reading one or two files
- `conversation-only`: Work whose brief would have to restate decisions that exist only in the conversation, not in any file
- `sequential`: Sequential work where each step directly uses the previous step's result
```

- 삭제: "Judge exceptions per task, not per session." 와 "including exceptions a project defines".
- "Dispatch prompts" 절의 "Exploratory measurement ... stay in the main session"은 그대로 두며, 예산을 넘으면 `read-anyway`로 선언한다. 새 ID는 만들지 않는다.

## 테스트 (`orchestration-guard.test.js`, `node orchestration-guard.test.js` → `ok`)

transcript 픽스처로 다음을 확인한다:
1. ORCHESTRATION.md를 import하지 않은 프로젝트는 항상 통과.
2. 서브에이전트 호출은 항상 통과.
3. 누적 9,999자 → 통과, 10,000자 이상 → deny.
4. Agent/SendMessage 이후 누적이 0부터 다시 시작.
5. 새 prompt_id는 0부터.
6. 유효 예외 줄 이후 0부터, 다시 10,000자에서 deny.
7. 무효 ID 예외 줄은 리셋하지 않고, 사유에 무효 표시.
8. 이전 prompt의 예외 줄은 무효.
9. `~/.claude/`, `.claude/` 아래 Edit/Write는 세지 않고, 예산 초과 뒤에도 통과.
12. 이미지 블록 결과는 3,000자로 셈.
13. Stop 이벤트 입력에는 출력 없음.
10. ORCHESTRATION.md를 못 읽으면 접두사만으로 유효.
11. transcript가 없으면 통과.

## 구현자에게 맡기는 것

- ID 파싱 정규식, 사유 문구의 세부.
- ORCHESTRATION.md 경로: `os.homedir()/.claude/ORCHESTRATION.md` 고정.
- 같은 메시지 안 병렬 호출에서 형제 호출 결과가 transcript에 아직 없을 때의 오차(한 호출 분량)는 허용.

## 남은 위험

- PreToolUse 시점에 직전 tool_result와 같은 메시지의 앞선 텍스트 블록이 transcript에 이미 기록되어 있다고 가정한다. 현행 PreToolUse 예외 줄 통과가 같은 가정 위에서 동작한다.
- 매 직접 호출마다 transcript 전체를 파싱한다. 세션이 길어지면 느려질 수 있다(`ponytail:` 주석으로 표시).
