# claude-config

`~/.claude`에서 기기 간에 옮길 것만 whitelist(`.gitignore`)로 관리한다. 인증 정보·히스토리·메모리 등 나머지는 추적하지 않는다.

- `ORCHESTRATION.md` — 서브에이전트 오케스트레이션 원칙 (메인 세션용)
- `agents/` — 역할별 서브에이전트 정의 (investigator, editor, verifier, architect)

## 새 PC에 설치

`~/.claude`가 이미 있어도 된다. 추적 대상 파일만 받아온다.

```sh
cd ~/.claude
git init -b main
git remote add origin https://github.com/moonbinchoi/claude-config.git
git pull origin main
```

## 프로젝트에 적용

프로젝트의 `CLAUDE.md`에 한 줄을 넣는다.

```
@~/.claude/ORCHESTRATION.md
```

## 수정

`~/.claude`에서 고치고 커밋·push, 다른 PC에서 `git pull`.

새 파일을 추적하려면 `.gitignore`에 `!경로`를 추가한다.
