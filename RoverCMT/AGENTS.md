# RoverCMT Agent Instructions

이 문서는 RoverCMT를 수정하거나 분석하는 AI 에이전트가 가장 먼저 읽어야 하는 진입 문서다.

## Project planning / milestones

- 계획, 현재 active milestone, 다음 작업, 아이디어, 폐기 결정의 source of truth: [`docs/milestones/README.md`](docs/milestones/README.md)
- 현재 프로젝트 상태나 다음 작업을 판단하기 전에 이 milestone 문서를 먼저 읽는다.
- 아이디어 추가, 작업 시작, 작업 폐기, milestone 변경 전에도 그 문서의 규칙(§7–§8)을 먼저 읽는다.
- M1 구현 작업("M1 Step N 진행해", "다음 Step 진행해")은 [`docs/milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md`](docs/milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md)의 절차와 Architecture Direction을 따른다.
- 이전 대화의 기억에 의존하지 않는다. repository의 현재 문서를 source of truth로 쓰고, 충돌하면 최신 상태를 확인하거나 사용자에게 묻는다.

## 작업 전 필수 문서

다음 문서를 순서대로 읽는다.

1. `docs/PROJECT_VISION.md`
2. `docs/MIGRATION_PRINCIPLES.md`
3. `docs/milestones/README.md` — 현재 계획과 active milestone
4. `docs/CURRENT_STATUS.md` — milestone 도입 이전 분석 단계(Phase 0) 기록

기존 CarrotMangaTranslator를 분석하는 작업이라면 추가로 다음 문서를 읽는다.

5. `docs/ANALYSIS_PLAN.md`

관련 분석 문서(`docs/analysis/`)는 milestone item의 Related analysis 링크를 따라 작업 범위에 맞게 읽는다.

---

## 가장 중요한 원칙

RoverCMT는 CarrotMangaTranslator의 축소판을 만드는 프로젝트가 아니다.

CarrotMangaTranslator에서 이미 검증된 유용한 구현과 알고리즘을 참고하고 이식하되,
RoverCMT의 목적에 맞는 더 작고 단순한 구조를 새로 만든다.

CarrotMangaTranslator와의 동작 호환성, 기능 호환성, 내부 구조 호환성은 목표가 아니다.

기존 CarrotMangaTranslator는 migration 기간 동안 reference implementation으로 취급한다.

---

## 개발 우선순위

대체로 다음 순서를 우선한다.

1. 자동화된 end-to-end 처리
2. 빠른 결과물 생성
3. 불필요한 대기와 반복 작업 제거
4. 단순하고 이해하기 쉬운 구조
5. AI coding agent가 적은 context로 분석하고 수정할 수 있는 코드
6. 기존의 유용한 번역 품질 유지
7. 수동 편집 기능
8. 드문 edge case에 대한 복잡한 복구

이 순서는 절대적인 성능 수치가 아니라 설계 판단의 기본 방향이다.

---

## 작업 규칙

- 기존 코드를 무조건 보존하지 않는다.
- 기존 코드를 무조건 다시 작성하지도 않는다.
- 검증된 핵심 로직은 가능한 한 재사용한다.
- 불필요한 abstraction과 compatibility layer는 가져오지 않는다.
- parent CarrotMangaTranslator source를 RoverCMT runtime dependency로 직접 import하지 않는다.
- 이식할 코드는 RoverCMT 내부의 독립적인 코드가 되어야 한다.
- 기능 추가 전 현재 구조와 실제 call path를 확인한다.
- 추측으로 기존 동작을 재구현하지 않는다.
- 복잡한 recovery를 추가하기 전에 실제 가치와 비용을 평가한다.
- 성능, 복잡도, LLM 호출량, 유지보수 비용과 품질 사이의 trade-off를 명시한다.
- trade-off가 존재하면 임의로 복잡한 방향을 선택하지 말고 사용자에게 판단 근거를 제시한다.
- 현재 요청 범위를 넘어선 대규모 리팩터링을 임의로 수행하지 않는다.

---

## 문서 유지

구조나 중요한 설계 결정이 변경되면 관련 문서를 함께 갱신한다.

특히 계획, 진행 상태, 다음 작업, 아이디어, 폐기 결정은 `docs/milestones/`에서만 관리하고 실제 코드와 일치하도록 유지한다. 다른 문서에는 링크만 둔다.

분석 결과와 확정된 사실을 프로젝트 목표나 추측과 혼합하지 않는다.