# claude-orchestration

Claude Code 메인 세션이 작업을 서브에이전트에 위임하도록 하는 규칙, 역할 에이전트, 가드 훅을 한곳에서 관리한다. 설치하면 `~/.claude` 아래에 복사된다.

## 구성

- `ORCHESTRATION.md`: 위임 원칙(메인 세션용). 프로젝트 `CLAUDE.md`에서 import해서 켠다.
- `agents/`: 역할 정의 4개. investigator(조사), editor(편집), worker(실행), architect(설계·리뷰).
- `hooks/orchestration-guard.js`: 메인 세션이 위임 없이 직접 작업을 계속하면 막는 PreToolUse·Stop 훅. `orchestration-guard.test.js`가 자체 점검이다(`ok` 출력).
- `settings/hooks.json`: `~/.claude/settings.json`에 합칠 훅 등록 조각.
- `docs/design/`: 설계 문서. `2026-10-17-orchestration-guard-design.md`는 가드 재설계 초안이며 아직 승인 전이다.
- `analysis/`: 지난 세션 기록으로 위임 비용을 측정한 스크립트와 결과(`results/`).
- `HANDOFF.md`: 다음 할 일.

## 이 PC에 적용

Claude Code에 이렇게 요청한다.

```
E:\Claude\claude-orchestration을 읽고 이 PC에 적용해 줘
```

새 PC라면 먼저 받는다.

```sh
git clone https://github.com/moonbinchoi/claude-orchestration.git E:/Claude/claude-orchestration
```

Claude는 `INSTALL.md` 절차를 따른다. 파일을 `~/.claude`에 복사하고, 훅 등록을 `settings.json`에 합치고, 자체 점검을 돌린다.

## 프로젝트에서 켜기

프로젝트의 `CLAUDE.md`에 한 줄을 넣는다. 이 줄이 문서와 훅을 함께 켜는 유일한 스위치다. 훅은 세션 위치에서 위로 올라가며 `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`에 `ORCHESTRATION.md`라는 글자가 있을 때만 동작한다.

```
@~/.claude/ORCHESTRATION.md
```

프로젝트 밖 파일 import라서 그 프로젝트에서 처음 세션을 열 때 승인 대화상자가 한 번 뜬다.

## 수정

이 저장소에서 고치고, 자체 점검이 `ok`인지 확인한 뒤 적용하고 커밋한다. `~/.claude`에서 직접 고쳤다면 이 저장소로 다시 복사해서 커밋한다.

## 분석 스크립트

모두 `~/.claude/projects/`의 transcript를 읽는다. 결과는 표준 출력으로 나온다.

```sh
node analysis/overhead.js                         # 서브에이전트 고정 시작 비용
node analysis/direct.js analysis/clusters.json    # 메인 직접 호출 결과 크기 (아래 두 스크립트의 입력 생성)
node analysis/cost.js analysis/clusters.json      # 도구별 메인 맥락 비용, Grep/Glob 위임 비교
node analysis/bash.js analysis/clusters.json      # Bash 명령 종류별 비용
node analysis/window.js                           # 글자 수 기준값 보정
node analysis/delegcost.js                        # 기준값 초과분 위임 비용
node analysis/sim.js                              # 현재 구조 개선안 vs executor 구조 비용 시뮬레이션
```

가격표는 스크립트 안에 하드코딩되어 있다(2026-10-17, platform.claude.com 가격 페이지 기준). 가격이 바뀌면 고친다.
