# claude-config

`~/.claude`에서 기기 간에 옮길 것만 whitelist(`.gitignore`)로 관리한다. 인증 정보·히스토리·메모리 등 나머지는 추적하지 않는다.

- `ORCHESTRATION.md` — 서브에이전트 오케스트레이션 원칙 (메인 세션용)
- `agents/` — 역할별 서브에이전트 정의 (investigator, editor, worker, architect)

오케스트레이션 규칙·역할 에이전트·가드 훅의 원본은 [claude-orchestration](https://github.com/moonbinchoi/claude-orchestration)(private)이다. 여기서 추적하는 `ORCHESTRATION.md`와 `agents/`는 그 사본이며, 가드 훅과 `settings.json` 등록은 여기서 추적하지 않는다. 설치·적용·수정은 그 저장소의 README를 따른다.

## 새 PC에 설치

`~/.claude`가 이미 있어도 된다. 추적 대상 파일만 받아온다.

```sh
cd ~/.claude
git init -b main
git remote add origin https://github.com/moonbinchoi/claude-config.git
git pull origin main
```

오케스트레이션 설정(가드 훅 포함)은 이어서 claude-orchestration을 적용한다. Claude Code에 "E:\Claude\claude-orchestration을 읽고 이 PC에 적용해 줘"라고 요청한다.

## 수정

오케스트레이션 파일은 claude-orchestration에서 고친다. 그 밖의 파일은 `~/.claude`에서 고치고 커밋·push, 다른 PC에서 `git pull`.

새 파일을 추적하려면 `.gitignore`에 `!경로`를 추가한다.
