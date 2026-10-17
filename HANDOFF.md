# 다음 할 일

## 가드 훅 재설계 (진행 중, 설계 승인 대기)

목표: 메인 세션이 ORCHESTRATION.md를 더 엄격하게 지키게 한다. 엄격함은 규칙을 명확하게 적용해서 얻는다(가드와 문서가 같은 규칙을 말하고, 위반 신호는 Claude에게 간다).

- 설계 초안: `docs/design/2026-10-17-orchestration-guard-design.md` (이 위치에 저장하기로 함)
- 근거 데이터: `analysis/results/`, 스크립트 사용법은 `README.md`

초안에 이미 반영된 결정:
- 예산: 호출 8회 → 직접 작업 글자 수 10,000자. 신호: 사용자 ask → Claude에게 deny
- 예외 줄 `Delegation exception: <id> -- <task>`, ID는 ORCHESTRATION.md에서 읽음. 한 줄은 새 예산 한 번
- git·작은 Edit 면제 삭제, `.claude` 아래 Edit/Write만 면제(세지도 거부하지도 않음). 이미지·PDF 블록은 3,000자
- Stop 훅과 임시 로그 삭제, transcript만으로 계산

초안 작성 뒤 나온 수정안 (초안에 아직 반영 안 됨, 승인 필요):
- 예산은 도구 결과(메인으로 들어오는 쪽)만 센다. Edit/Write 입력은 세지 않는다
  - 근거: editor·sonnet-5.5 중앙값 지시문 1,132자 > editor 출력 203토큰. 편집 위임은 직접 대비 −10% ~ +409%
- ORCHESTRATION.md: "편집은 editor" → "지시문보다 바뀌는 양이 훨씬 클 때만 editor"(번역, 일괄 치환, 정해진 리팩터)
- 구조 선택: A(현재 구조 개선) 권고. 시뮬레이션(`analysis/sim.js`) 결과 A −10~12%, B(OMC식 executor + 도메인 리뷰) −14~33%. 다만 B는 직접 작업 많은 메시지의 절반 이상을 통째로 위임할 수 있어야 A보다 싸고, 그 비율은 기록으로 잴 수 없음
- B는 코드 프로젝트에서 별도로 시험할 후보로 남김

다음 단계:
1. 위 수정안의 승인을 받는다
2. 설계 문서에 반영하고 승인을 받는다
3. superpowers:writing-plans로 계획을 세운다
4. 구현: `hooks/`, `ORCHESTRATION.md`, `settings/hooks.json`을 고치고 테스트 `ok` → `INSTALL.md`로 적용 → 커밋
