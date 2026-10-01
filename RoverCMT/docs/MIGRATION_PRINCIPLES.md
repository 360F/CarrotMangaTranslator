# RoverCMT Migration Principles

## 1. 기본 전략

RoverCMT는 CarrotMangaTranslator를 한 번에 rewrite하지 않는다.

기존 프로젝트를 reference implementation으로 유지하면서
필요한 기능을 단계적으로 분석하고 RoverCMT로 이식한다.

각 단계는 가능한 한 독립적으로 검증한다.

---

## 2. 재사용과 재작성 기준

기존 코드가 다음 조건을 만족한다면 가능한 한 재사용한다.

- 이미 실제 사용을 통해 검증되었다.
- RoverCMT에서도 동일한 역할이 필요하다.
- 불필요한 dependency를 대량으로 끌고 오지 않는다.
- 현재 구조에서 분리 가능한 로직이다.

반대로 다음 경우에는 기존 코드를 그대로 가져오는 것을 재검토한다.

- Carrot 전용 UI state에 강하게 결합되어 있다.
- human review workflow를 전제로 한다.
- 불필요한 history/state persistence에 의존한다.
- 사용하지 않을 기능을 대량으로 dependency로 요구한다.
- compatibility를 위한 abstraction이 대부분이다.
- 단순한 작업을 위해 여러 계층을 통과해야 한다.
- 성능상 불필요한 blocking I/O 또는 반복 처리를 요구한다.

이 경우 필요한 핵심 알고리즘만 분리하거나
RoverCMT 구조에 맞는 작은 adapter를 작성할 수 있다.

---

## 3. Parent Project 의존 금지

RoverCMT의 runtime 코드는 parent CarrotMangaTranslator source를 직접 import하지 않는다.

금지 예:

import { something } from "../../src/...";

Migration 중 기존 코드를 참고하거나 복사하여 이식하는 것은 허용하지만,
이식된 코드는 RoverCMT 내부에서 독립적으로 build/test/run 가능해야 한다.

현재 parent는 같은 repo 루트의 읽기 전용 reference source(`src/`, 루트 `package.json` 등)다.
RoverCMT 코드는 루트 `src/`를 import하거나 루트 `package.json` 의존성에 기대지 않는다.

최종적으로 루트 reference source를 제거해도
RoverCMT가 정상적으로 동작하는 상태를 목표로 한다. 제거 시점은 사용자가 정한다([AGENTS.md](../../AGENTS.md#rovercmt-작업)).

---

## 4. 단계적 이식

기능은 가능한 작은 단위로 이식한다.

예상되는 큰 흐름은 다음과 같다.

Detection
→ OCR
→ Translation
→ Mapping
→ Erase
→ Typography / Layout
→ Render / Export

실제 migration 순서는 상세 분석 후 결정한다.

한 번에 전체 pipeline을 복사하지 않는다.

각 단계에서 다음을 확인한다.

1. 실제 필요한 입력
2. 실제 생성하는 출력
3. 필요한 dependency
4. 기존 state dependency
5. UI dependency
6. filesystem dependency
7. external runtime dependency
8. 실패 처리
9. 성능 비용
10. RoverCMT에서 제거 가능한 동작

---

## 5. Behavior Compatibility

CarrotMangaTranslator와 동일한 동작을 유지하는 것은 목표가 아니다.

Migration 과정에서 다음은 변경될 수 있다.

- state model
- file layout
- output 조건
- retry 정책
- error handling
- UI workflow
- review workflow
- completion semantics
- cache 정책
- persistence 정책
- pipeline scheduling

단, 기존 동작을 변경하거나 제거할 때는
그 동작이 왜 존재하는지 먼저 코드에서 확인한다.

이해하지 못한 코드를 단순히 불필요해 보인다는 이유로 제거하지 않는다.

---

## 6. Quality vs Complexity

기존 기능이 번역 품질 또는 안정성을 향상시키더라도
그 비용이 큰 경우 trade-off 대상으로 취급한다.

평가할 비용:

- runtime
- GPU 사용량
- VRAM
- CPU 사용량
- disk I/O
- LLM 호출 횟수
- LLM token 사용량
- 코드 복잡도
- dependency 수
- state complexity
- 테스트 비용
- AI coding agent가 요구하는 context 크기

품질 향상의 실제 효과와 위 비용을 비교한다.

비용 대비 가치가 낮다면 제거하거나 단순화할 수 있다.

---

## 7. Recovery Policy

모든 실패를 자동으로 복구하려 하지 않는다.

복구가 매우 저렴하고 신뢰할 수 있다면 유지할 수 있다.

하지만 복구를 위해 반복적인 LLM 호출,
복잡한 heuristic,
여러 단계의 fallback,
대규모 state tracking이 필요하다면
실패를 허용하는 것이 더 적절할 수 있다.

실패를 허용하더라도 가능한 한 다음은 남긴다.

- 어느 페이지에서 실패했는지
- 어느 단계에서 실패했는지
- 가능한 경우 실패 원인
- 재실행 가능 여부

---

## 8. Performance

성능은 개별 함수의 실행시간만으로 판단하지 않는다.

전체 pipeline의 time-to-output을 기준으로 본다.

특히 다음을 조사한다.

- stage 사이의 idle time
- 불필요한 serialization
- 반복적인 전체 state 저장
- 반복적인 JSON/CSV 생성
- blocking filesystem I/O
- 불필요한 renderer/main IPC
- 동일 데이터의 반복 변환
- 필요 이상의 model invocation
- page 단위 작업 사이의 blocking
- 불필요한 runtime initialization

성능 개선 때문에 구조가 지나치게 복잡해지는 경우에도 trade-off를 평가한다.

---

## 9. 테스트

기존 CarrotMangaTranslator 전체 test suite를 RoverCMT에서 유지하는 것은 목표가 아니다.

이식한 핵심 로직에는 작고 직접적인 테스트를 작성한다.

특히 다음을 우선한다.

- 실제로 발견된 regression
- 데이터 mapping
- reading order
- pipeline stage 연결
- output 생성
- 실패 처리
- 중요한 format/schema

테스트 자체를 유지하기 위해 production architecture가 복잡해지는 상황을 피한다.

---

## 10. Migration 완료 조건

RoverCMT가 필요한 end-to-end pipeline을 독립적으로 수행하고,
더 이상 parent project runtime code에 의존하지 않게 되면
CarrotMangaTranslator parent source 제거를 검토할 수 있다.

Parent source 제거는 migration 마지막 단계에서 수행한다.

그 전까지 기존 프로젝트는 reference 및 비교 대상으로 보존한다.