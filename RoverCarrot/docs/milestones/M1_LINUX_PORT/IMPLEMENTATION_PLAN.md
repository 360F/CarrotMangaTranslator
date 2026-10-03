# M1 — Implementation Plan

[M1 README](README.md) · [M1 CURRENT](CURRENT.md) · [Planning index](../README.md)

이 문서는 M1 CURRENT item들을 실제로 구현하기 위한 **실행 계획**이다. Step 순서, checkpoint, 선행 조건, 검증, 완료 기준을 관리한다.

| 문서 | 역할 |
|---|---|
| [CURRENT.md](CURRENT.md) | M1에서 하기로 결정한 persistent item과 그 `Progress`의 **source of truth**. item 설명, 결정, 근거 analysis는 여기에 있다 |
| IMPLEMENTATION_PLAN.md (이 문서) | CURRENT item을 구현하는 순서와 Step 단위 작업 계획. CURRENT를 대체하지 않는다 |

- Step `Status`는 CURRENT item의 `Progress`를 대체하지 않는다. Step을 마치면 관련 item의 `Progress`도 CURRENT.md에서 따로 갱신한다.
- 이 문서는 item 설명을 복제하지 않는다. 각 Step은 M1 item ID와 analysis section으로 링크한다.

## 현재 위치

이 표가 M1 **handoff**(현재 Step·State·Next role의 source of truth)다. 새 session은 이 표를 읽고 [How to use this plan (agent)](#how-to-use-this-plan-agent)를 따른다. 결론이 아니라 사실과 위치만 짧게 두고, 긴 log와 review는 Evidence 위치에 둔다. 기준 commit의 의미와 판정은 [기준 commit과 Git 판정](#기준-commit과-git-판정)을 따른다.

| 항목 | 값 |
|---|---|
| Active milestone | **M1 — Linux Port** ([목표와 요구사항](README.md#목표)) |
| 현재 Step | [Step 3 — OCR / Hayai](#step-3--ocr--hayai) |
| State | **REVIEW** — 2026-10-03 Step 3 구현·자체 검증 완료(work commit `044c5743`). 독립 review 대기 |
| Next role | **review** |
| 기준 commit | `044c5743ba3ea259ddcf0a6e80c4a49531bf01e0`(accepted HEAD: Step 3 HayaiOCR work commit = 검증 대상 commit) |
| Task | Step 3 Scope 구현과 [Reference-driven validation](#reference-driven-validation). 시작할 때 `STEP3_VALIDATION.md`를 만든다 |
| 기준 문서 | [Step 3](#step-3--ocr--hayai), [M1-OCR-001](CURRENT.md#m1-ocr-001--hayaiocr-linux-runtime), Step 3의 Related analysis·Source areas(Carrot reference) |
| Evidence / findings | [STEP3_VALIDATION.md](STEP3_VALIDATION.md)(tracked; Review findings 표 비어 있음), Git 제외 `RoverCarrot/test-data/validation/m1-step3/` |
| Open findings / cycle | 없음 / 0 of 3 |
| 진행 기록 | 2026-10-03 implementation: Hayai worker(reference byte-identical)·Linux CPU/cu130 lock·OCR stage/adapter 구현. 검증: check 54/54, smoke 15/15, boundaries, Python 11/11, CPU differential 3p/21, GPU differential 46p/261(reference worker·정규화·저장 결과 text 일치), 4-page CPU/GPU CLI, strict schema. 남은 것: 독립 review. 실제 subdivided/recovered/failed 사례는 reference corpus에 없음(deterministic test만). 다음 action: fresh review session |
| 다음 transition | 독립 review 판정에 따라 FIX(cycle +1) / CHECKPOINT_READY / BLOCKED. review commit이 있으면 기준 commit = review commit |

## Progress

| Step | Name | Status | Main checkpoint |
|---|---|---|---|
| 1 | [Core Architecture, Contracts & CLI Adapter](#step-1--core-architecture-contracts--cli-adapter) | DONE | Carrot loader contract 확인 + Core boundary + CLI로 minimal pipeline smoke. **사용자 검토 checkpoint** |
| 2 | [Detection / Koharu](#step-2--detection--koharu) | DONE | Linux detection 결과가 기존 `hayai-regions.json`과 region 수·bbox·순서 일치 |
| 3 | [OCR / Hayai](#step-3--ocr--hayai) | REVIEW | Linux Hayai `sourceText`가 기존 결과와 일치 |
| 4 | [Translation](#step-4--translation) | NOT_STARTED | 같은 입력으로 같은 request·parse·merge·memory 갱신 |
| 5 | [Typography / Layout](#step-5--typography--layout) | NOT_STARTED | 고정 입력의 font size·bubble layout이 reference와 일치 |
| 6 | [Inpainting / Erase](#step-6--inpainting--erase) | NOT_STARTED | Linux FLUX runner로 기존 mask·erase 결과 재현 |
| 7 | [Renderer (Skia primary)](#step-7--renderer-skia-primary) | NOT_STARTED | v3 fixture + Linux Skia smoke + font capability smoke |
| 8 | [Full Integration & Interoperability](#step-8--full-integration--interoperability) | NOT_STARTED | Linux 순차 E2E + managed translation lifecycle + Windows Carrot open/use |

### 기본 8-Step에서 바꾼 점

- **Step 5와 Step 6의 순서를 바꿨다**(사용자 초안: 5 = Inpainting, 6 = Typography/Layout).
  - 이유 1: Carrot의 실제 stage 순서는 `… → translate → typography → erase → layout`이다. erase는 typography가 정한 `fontSizePx`를 mask padding에 쓴다([CORE §1](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#1-end-to-end-production-data-flow), [INPAINTING §5 Mask Generation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#5-mask-generation)).
  - 이유 2: erase의 bubble prepass는 layout stage와 같은 `runBubbleLayoutPostprocess`와 Koharu layout 재검출을 쓴다([DETECTION §8](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#8-detector-mask-lifecycle--3회-호출-검증)). layout을 먼저 이식하면 erase가 그 코드를 재사용할 수 있다.
  - layout은 inpainted 결과가 아니라 원본 raster로 재검출하므로 erase보다 먼저 구현해도 문제없다([CORE §15](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#15-minimal-e2e-contract)).
  - **구현 순서만 바뀐다. 런타임 stage 실행 순서는 Carrot과 같다**(typography → erase → layout).
- 그 외 Step 경계와 M1 scope는 바꾸지 않았다.

## How to use this plan (agent)

이 section이 M1 Step 작업의 agent workflow다. 구현과 독립 review는 서로 다른 새 session이 맡고, 대화 기억 대신 repository로 이어받는다: [현재 위치](#현재-위치)(handoff), 각 Step `Result`, Step validation 문서. "agent instructions와 현재 handoff를 읽고 지정된 다음 작업을 수행해", "M1 Step N 진행해", "다음 Step 진행해" 같은 호출은 모두 이 절차를 뜻한다.

### Role과 session 시작

| Role | 맡는 State | 기본 배정 |
|---|---|---|
| implementation | IMPLEMENT, FIX | Codex |
| review | REVIEW | Claude Code |

기본 배정은 현재 운영 기준이고 규칙은 role 기준이다. 사용자가 호출에서 role을 지정하면 그것을 따르고, 배정이 없거나 모호하면 사용자에게 묻는다. 한 session이 같은 Step의 구현과 review를 함께 맡지 않는다.

모든 session은 작업 전에 다음을 확인한다.

1. [Git 흐름](../../../AGENTS.md#git-흐름)의 session 시작 점검(branch, clean tree, fetch, remote 동기화)을 한다. 다른 agent의 미커밋 변경은 건드리지 않는다.
2. [기준 commit과 Git 판정](#기준-commit과-git-판정)을 통과해야 한다. 실패하면 작업하지 않고 BLOCKED로 보고한다.
3. Next role이 자기 role과 다르면 작업하지 않고 필요한 role을 보고한다. CHECKPOINT_READY·BLOCKED에서는 Next role이 user다.
4. 사용자 메시지에 명시적인 Step 승인이 있으면 [사용자 checkpoint 승인](#사용자-checkpoint-승인)을 따른다.

### 기준 commit과 Git 판정

기준 commit은 현재 handoff 상태를 기록하는 handoff-only commit 직전의 accepted repository HEAD이다. handoff commit 자신의 hash가 아니다. handoff-only commit이 여러 개 이어지면 기준 commit은 그 앞의 accepted HEAD로 유지한다.

- handoff-only commit이 바꿀 수 있는 파일은 다음 두 개뿐이다. 다른 파일은 markdown이라도 handoff delta로 자동 허용하지 않는다.
  - `RoverCarrot/docs/milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md`
  - `RoverCarrot/docs/milestones/M1_LINUX_PORT/CURRENT.md`
- handoff-only commit은 handoff 동기화 내용(현재 위치 표, Progress·Step Status·Result, CURRENT item Progress·History)만 바꾼다. workflow policy, `AGENTS.md`, `CLAUDE.md`, `RoverCarrot/AGENTS.md`, milestone README, Step validation 문서, production/test/source 변경은 handoff delta가 아니다. 이런 변경은 그 변경을 완료한 commit을 새 accepted HEAD로 삼고, 별도 handoff-only commit에서 기준 commit을 그 hash로 갱신한다. "기능 변경이 없으니 예전 기준 commit도 괜찮다" 같은 예외는 없다.
- 새 session은 [Git 흐름](../../../AGENTS.md#git-흐름)의 fetch·remote 동기화 뒤 아래를 모두 확인한다. 하나라도 실패하면 BLOCKED다. C는 최종 diff가 아니라 commit마다 보므로, 중간 commit에서 다른 파일을 바꿨다가 되돌린 경우도 실패한다.

```bash
BASE=<handoff 기준 commit>
git merge-base --is-ancestor "$BASE" HEAD   # A. ancestry: 실패하면 BLOCKED
git rev-list --merges "$BASE"..HEAD         # B. merge commit: 출력이 있으면 BLOCKED
for c in $(git rev-list "$BASE"..HEAD); do  # C. commit별 변경 경로: 출력이 있으면 BLOCKED
  git diff-tree --no-commit-id --name-only --no-renames -r "$c"
done | grep -vx -e 'RoverCarrot/docs/milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md' \
                -e 'RoverCarrot/docs/milestones/M1_LINUX_PORT/CURRENT.md'
git log --oneline "$BASE"..HEAD             # D. 기준 이후 commit 목록: handoff 갱신 commit만 있어야 함
```

### State와 transition

Step `Status`([Progress](#progress), 각 Step section)와 handoff State는 같은 값을 쓴다. 과거 기록의 `IN_PROGRESS`는 IMPLEMENT·REVIEW·FIX 중 하나에 해당하는 이전 표기다.

| State | 의미 | Next role | 다음 State |
|---|---|---|---|
| NOT_STARTED | 아직 열리지 않은 Step | — | 이전 Step이 DONE이 되면 IMPLEMENT |
| IMPLEMENT | 착수 가능 또는 구현 중 | implementation | 구현·자체 검증 후 REVIEW |
| REVIEW | 독립 검증 차례 | review | FIX, CHECKPOINT_READY 또는 BLOCKED |
| FIX | finding 수정·반박 차례 | implementation | REVIEW |
| CHECKPOINT_READY | review 통과, 사용자 승인 대기 | user | 사용자 승인 시 DONE |
| BLOCKED | 사용자 판단 필요 | user | 사용자 결정에 따름 |
| DONE | 사용자 승인 완료 | — | 다음 Step을 IMPLEMENT로 연다 |

### Implementation role

1. Step의 Related M1 items → [CURRENT.md](CURRENT.md)의 해당 item → Related analysis section → Source areas 순서로 필요한 section만 읽는다.
2. Prerequisites와 필요한 GPU/runtime(Hayai CUDA, FLUX 등)을 확인한다. 없으면 [실행 환경](../../../AGENTS.md#실행-환경) 규칙대로 Result에 "Rover PC에서 추가 검증 필요"를 남기고, 아래 실행 환경 부족 규칙에 따라 BLOCKED로 둔다.
3. 구현 전에 reference source와 observable contract를 식별해 Step validation 문서에 적는다([Reference-driven validation](#reference-driven-validation)).
4. [Architecture Direction](#architecture-direction)과 Step의 Explicit non-goals를 지키고 한 번에 한 Step만 구현한다. Step의 Open decisions를 처리하되, 사용자 판단이 필요한 trade-off는 임의로 고르지 않는다. coupling은 [Coupling 기록 규칙](#coupling-기록-규칙)대로 남긴다.
5. 자체 test, 가능한 differential validation, regression(`npm run check`, `npm run smoke`, `npm run check:boundaries`)을 실행한다.
6. code·test와 Step validation 문서(변경 범위, requirement 위치, 실행한 command와 결과, evidence 위치)를 work commit으로 남긴다. 이 commit이 accepted HEAD다. 이어서 handoff-only commit에서 Step `Result`와 handoff를 REVIEW / review, 기준 commit = 그 work commit으로 갱신하고 둘 다 push한다. "reference와 완벽히 일치" 같은 결론을 oracle처럼 쓰지 않는다.
7. FIX에서는 OPEN finding을 수정하거나 반박한다([반복 제한과 의견 불일치](#반복-제한과-의견-불일치)). finding Status를 FIXED 또는 DISPUTED로 바꾸고 같은 방식으로 REVIEW로 넘긴다.

사용자 checkpoint 없이 다음 Step을 시작하지 않는다.

### Independent review role

- 기준은 milestone 요구사항, 실제 code/diff, 수정하지 않은 Carrot reference, fresh execution 결과다. implementation agent의 설명·결론·생성된 comparison 결과는 oracle이 아니다. 가능하면 그것을 읽기 전에 reference·code·fresh execution으로 잠정 결론을 만들고, 나중에 대조한다.
- 구현자가 만든 differential test와 comparator도 검증 대상이다. 비교 필드 누락, normalization으로 차이 은폐, fixture 편향, reference와 Rover 양쪽에 같은 잘못된 adapter 사용, 기존 generated result를 fresh baseline처럼 사용, 구현 결과에 맞춰 완화된 comparator 같은 false parity를 확인한다. 필요하면 reference/baseline을 직접 다시 실행한다.
- production code와 영구 test는 수정하지 않고, 필요한 변경은 finding으로 남긴다. 사용자가 reviewer나 validation tooling 자체를 작업 대상으로 지정한 경우만 예외다.
- 임시 script와 scratch는 [로컬 전용 데이터](../../../AGENTS.md#로컬-전용-데이터) 규칙대로 repo 밖에 둔다. tracked 변경은 Step validation 문서의 finding(review commit)과 handoff(handoff-only commit)뿐이다.
- 판정: REQUIRED_FIX가 있으면 FIX. REQUIRED_FIX가 없고 USER_DECISION_REQUIRED가 남으면 BLOCKED(fix 방향을 좌우하는 사용자 판단이면 바로 BLOCKED). 둘 다 없고 필수 검증이 통과했으며 남은 차이가 이미 승인된 known difference뿐이면 CHECKPOINT_READY. finding을 review commit으로 남긴 뒤, handoff-only commit에서 판정에 맞게 State, Next role, Open findings / cycle을 갱신하고 기준 commit을 그 review commit으로 둔다(review commit이 없으면 기준 commit을 그대로 둔다). targeted revalidation은 FIXED·DISPUTED finding과 그 영향 범위에 집중한다.
- Step을 DONE 처리하거나 다음 Step을 시작하지 않는다.

### Findings와 disposition

finding은 Step validation 문서의 `Review findings` 표에 한 줄씩 두고 상세 근거는 링크한다. fix session은 이 표와 링크만 읽어도 된다.

| 열 | 규칙 |
|---|---|
| ID | `S<n>-F<nn>`. 바꾸거나 재사용하지 않는다 |
| Severity | High / Medium / Low. 영향 크기이며 checkpoint gate와 별개다 |
| Disposition | reviewer는 새 finding에 `REQUIRED_FIX` 또는 `USER_DECISION_REQUIRED`만 지정한다. `ACCEPTED`·`DEFERRED`는 현재 사용자의 명시적 승인, 또는 authoritative 문서에 기록된 사용자 승인·승인된 known difference가 있을 때만 쓰고 그 근거를 링크한다 |
| Status | `OPEN` → `FIXED` 또는 `DISPUTED`(implementation) → `CLOSED` 또는 다시 `OPEN`(review) |
| Rounds | 해결되지 않은 채 끝난 연속 review 횟수 |

Low라는 이유만으로 deferred 처리하거나 checkpoint를 통과시키지 않는다. REQUIRED_FIX가 남아 있으면 CHECKPOINT_READY가 될 수 없다.

### 반복 제한과 의견 불일치

- REVIEW → FIX 전환마다 cycle을 1 늘려 handoff에 `n of 3`으로 적는다.
- 다음 중 하나면 더 반복하지 않고 BLOCKED(Next role user)로 넘긴다: 4번째 FIX가 필요함(3 cycle 초과), 같은 substantive finding이 연속 2회 review에서 해결되지 않음(Rounds 2), 두 agent가 같은 근거를 반복하며 결론이 바뀌지 않음, 수정할수록 acceptance 기준이 불명확해짐.
- implementation agent가 finding에 동의하지 않으면 무시하거나 억지로 고치지 않는다. Carrot reference behavior, fresh reproduction, code evidence로 반박을 finding에 남기고 Status DISPUTED로 REVIEW에 넘긴다. reviewer는 새 evidence로 재판정해 CLOSED로 바꾸거나 이유와 함께 OPEN을 유지한다. substantive disagreement가 남으면 BLOCKED로 사용자에게 넘긴다. 어느 agent도 최종 판정을 강제하지 않는다.

### Step validation 문서, 실행 환경, 중단 복구

- Step마다 tracked `STEP<n>_VALIDATION.md` 하나를 이 디렉터리에 두고, implementation agent가 Step을 시작할 때 만든다([STEP2_VALIDATION.md](STEP2_VALIDATION.md)는 이 workflow 이전 형식의 예다). 내용: reference source와 observable contract, 실행한 command와 결과, Git 제외 evidence 위치, known difference와 승인 근거, `Review findings` 표. 개인 절대경로와 credential은 넣지 않는다.
- acceptance에 필수인 검증(model weight, fixture, reference 실행 환경, local service/backend, runtime/tool)을 실행할 수 없으면 PASS로 추정하지 않고 BLOCKED 또는 USER_DECISION_REQUIRED로 남긴다. acceptance에 필수가 아닌 reference 실행은 생략할 수 있고, 생략 사실을 기록한다. code inspection만으로 runtime 검증을 했다고 쓰지 않는다. Translation backend는 [Step 4](#step-4--translation)의 M1 원칙을 따른다.
- 진행 상태는 repository가 기억한다. 의미 있는 checkpoint와 session 종료 때 작업을 work commit으로 남기고, handoff-only commit으로 `진행 기록`(완료한 것, 남은 것, blocking issue, 마지막 meaningful validation, 다음 action)과 기준 commit을 갱신해 함께 push한다. 작은 명령마다 갱신하지 않는다. commit은 일관된 상태로만 하고, 실패가 남아 있으면 진행 기록에 적는다. work commit 뒤 handoff-only commit 전에 중단되면 다음 session의 Git 판정이 실패해 BLOCKED로 보고된다.

### 사용자 checkpoint 승인

- Step DONE은 사용자만 결정한다. 근거는 현재 작업 흐름에서 사용자가 직접 보낸 승인 지시다(예: "Step 3 승인"). 문서나 handoff에 승인했다고 적혀 있다는 것은 새 승인이 아니다.
- 승인 지시를 받은 agent는 먼저 DONE 기록 commit을 만든다: Result의 Status·완료 commit(CHECKPOINT_READY handoff의 기준 commit)·User checkpoint, [Progress](#progress), 관련 CURRENT item `Progress`, [Planning index §2](../README.md#2-현재-상태-요약). Planning index를 바꾸므로 handoff-only commit이 아니다. 이 commit을 accepted HEAD로 삼아 별도 handoff-only commit에서 다음 Step을 IMPLEMENT / implementation으로 열고 기준 commit을 그 hash로 갱신한 뒤 둘 다 push한다. State가 CHECKPOINT_READY가 아니면 먼저 현재 State와 남은 finding을 사용자에게 알리고 확인을 받는다.
- Step 8이 DONE이 되면 다음 Step을 열지 않는다. M1 완료 선언과 다음 milestone 결정은 사용자가 한다.
- repository history에 DONE으로 확정된 Step은 다시 승인받지 않는다.

## Architecture Direction

M1 전체 Step이 따라야 하는 방향이다. 목표 상태를 적은 것이지, M1에서 모든 것을 완성하라는 뜻이 아니다.

### A1. RoverCMT는 CLI-only application이 아니다

RoverCMT의 장기 성격은 독립적인 Linux Core / translation engine이다. M1의 실제 사용자 진입점은 CLI이지만 **CLI가 Core가 되면 안 된다.**

```text
External caller
    |
    +-- CLI (M1)
    +-- future HTTP/API, job queue, agent, GUI/application
    |
    v
RoverCMT programmatic/public boundary
    |
    v
Pipeline / orchestration
    |
    v
Stages / runtime implementations
```

- CLI parsing, terminal 출력에 Core business logic을 넣지 않는다. CLI는 programmatic boundary를 호출하는 adapter다.
- M1에서 HTTP server, RPC, WebSocket, 인증 등을 미리 만들지 않는다. M1의 최소 요구는 `programmatic Core boundary ← CLI adapter` 구조다.
- 나중에 더 큰 시스템이 RoverCMT를 호출할 때 CLI subprocess와 terminal 출력 parsing에 의존하지 않아도 되게 한다.

### A2. 상위 Core는 하위 implementation을 가능한 한 몰라야 한다

```text
Pipeline
  +-- Detection boundary    \-- Koharu implementation
  +-- OCR boundary          \-- Hayai implementation
  +-- Translation boundary  \-- managed llama-server + OpenAI-compatible client
  +-- Inpainting boundary   \-- FLUX implementation
  \-- Renderer boundary     +-- Skia implementation
                            \-- Playwright fallback/reference
```

- 상위 orchestration은 Hayai, Koharu, FLUX, Skia 자체보다 그 stage가 제공하는 기능·contract에 의존하는 방향을 지향한다.
- **완전한 plugin architecture를 만들지 않는다.** factory, registry, DI framework, 쓸지 모르는 interface를 미리 대량으로 만들지 않는다.
- boundary는 다음에 해당하는 곳부터 둔다.
  - runtime/library 교체 가능성이 높은 곳
  - 실행 방식이 다른 곳(subprocess, Python, Rust, HTTP, GPU runtime)
  - M3에서 독립 실행 단위가 될 가능성이 높은 곳
  - analysis에서 migration boundary가 이미 확인된 곳(예: [OCR §13](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#13-recommended-migration-boundary), [INPAINTING §12](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#12-linux-rovercmt-boundary), [TRANSLATION_PIPELINE §16](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#16-recommended-migration-boundary), [DETECTION §20](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#20-linux-rovercmt-boundary)); Translation §16의 managed 제외 권고는 [현재 결정](CURRENT.md#m1-baseline-decision-2026-10-03)으로 대체됨

### A3. M1은 완전한 decoupling을 요구하지 않는다

Carrot pipeline에는 실제 결합이 있다: shared page/block state, shared context, translation memory 순서 의존, persistence 의존, runtime/GPU 수명, bubble/layout data 의존([CORE §6 Stage Contract Matrix](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#6-stage-contract-matrix), [CORE §7 Dependency Graph](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#7-dependency-graph-필드-단위), [CORE §8 Runtime / GPU Ownership Map](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#8-runtime--gpu-ownership-map)).

- M1의 우선 목표는 기존 기능을 Linux에서 안전하게 E2E로 재현하는 것이다. **이 결합을 M1에서 억지로 전부 없애지 않는다.**
- 기존 기능을 보존하는 데 필요한 shared page/block state, shared context, mutable state, cross-stage 의존, runtime/resource 의존은 M1에서 허용한다.
- 다만 새 Core에서 이런 결합을 불필요하게 숨기거나 더 강하게 고착시키지 않는다.
- **"완전히 분리되지 않았다"는 이유로 Step을 실패 처리하지 않는다.** M1 완료 판단은 기능 이식과 Step의 contract/validation이 기준이다.

### A4. 없애지 못한 coupling은 명시적으로 보이게 한다

가능한 경우 각 stage에 대해 다음을 알 수 있게 한다(코드의 stage contract, 또는 Step Result 기록).

- 어떤 state를 읽고 어떤 state를 쓰는가
- 어떤 shared mutable state가 있는가
- 어떤 runtime/resource를 공유하는가
- 어떤 순서 의존과 persistence/memory 의존이 있는가

shared object가 있는지가 문제가 아니라 **의존이 숨겨진 global side effect가 되지 않는 것**이 중요하다. 실제 read/write 목록은 각 Step에서 source와 [CORE §6](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#6-stage-contract-matrix)·[§7](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#7-dependency-graph-필드-단위)을 확인해 정한다. 아래 Step의 "Architecture/coupling concerns"는 출발점일 뿐 구현 contract가 아니다.

### A5. 후속 milestone에서 점진적으로 분리한다

| Milestone | 이 방향에서의 역할 |
|---|---|
| M1 | Linux E2E 기능 이식, architecture boundary 형성, coupling 식별·명시, managed Gemma 4 26B + 순차 실행 baseline |
| M2 | 사용자 검토 Golden Sample·benchmark로 현재 동작 고정 |
| M3 | pipelining을 막는 shared mutable state·scheduling 의존 분리, page/stage concurrency, GPU/resource scheduling, 기존 Translation ↔ Erase overlap과 추가 concurrency(Post-M1) |
| M4 | runtime/provider 교체, stage별 성능 최적화, 필요한 추가 decoupling |

장기 목표: 하위 Detection/OCR/Translation/Inpainting/Renderer implementation이 바뀌어도 상위 Core와 외부 caller가 영향을 적게 받는 구조. **이 목표를 위해 M1 scope를 키우지 않는다.**

### A6. Stage implementation과 execution policy를 분리하는 방향

- **WHAT:** 각 stage가 어떤 input으로 어떤 result를 만드는가.
- **WHEN/HOW:** 언제 실행하는가, page 간 overlap, 동시성 한도, GPU/resource 조정.
- M1에서 완전한 scheduler abstraction을 만들 필요는 없다. 다만 stage implementation 안에 전체 pipeline scheduling 정책을 박아 넣어 M3에서 뜯어내기 어렵게 만들지 않는다.
- M1은 기존 순차 stage 순서를 이식·검증한다. Translation ↔ Erase 병렬 경로는 [M1-CORE-002 이동 기록](CURRENT.md#m1-core-002--기존-translation--erase-병렬-실행-경로-이식)을 따라 Post-M1이다. scheduling 정책은 orchestration에 둔다.

### A7. 기존 규칙

- parent Carrot source를 RoverCMT runtime dependency로 import하지 않는다. 코드는 RoverCMT 안으로 복사·정리한다([MIGRATION_PRINCIPLES §3](../../MIGRATION_PRINCIPLES.md#3-parent-project-의존-금지)).
- 이해하지 못한 Carrot 코드를 불필요해 보인다는 이유로 제거하지 않는다([MIGRATION_PRINCIPLES §5](../../MIGRATION_PRINCIPLES.md#5-behavior-compatibility)).
- 호환 기준은 [M1-COMPAT-001](CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability)이다: RoverCMT output을 Windows Carrot에서 open/use할 수 있으면 된다. 같은 구현·runtime·renderer, byte/pixel identical은 요구하지 않는다.

## Input Materialization Direction

장기 boundary는 `external input → input materialization → normalized pages → pipeline`이다.
현재 persistence adapter의 initialize가 `adapters/input.ts`를 호출하여 검증한
source bytes/width/height를 기존 Page contract로 저장한다. Core와 stage는 원본 형식,
archive 추출 여부, URL 다운로드 여부를 분기하지 않는다. 새 factory/framework는 없다.

- 현재 Step 1: PNG, JPEG/JPG, WebP, JFIF 단일 파일 및 direct mixed-format directory.
  case-insensitive extension, 기존 natural order; unsupported 파일/하위 directory 무시.
  손상된 supported 파일 하나라도 있으면 output 생성 전 전체 import 실패.
  실제 format과 extension 일치 검사 및 full pixel decode; 원본 bytes 보존,
  JFIF만 저장 suffix `.jpg`. EXIF 회전/animated multi-page 처리는 현재 하지 않는다.
- 범위 기준: Carrot 기존 지원 input = M1 parity, Carrot 미지원 = 신규 기능.
  Carrot의 실제 지원 범위(source evidence)는
  [CARROT_LOADER_OUTPUT_CONTRACT — Input / import capability](../../analysis/CARROT_LOADER_OUTPUT_CONTRACT.md#input--import-capability-d10-source-trace-2026-10-02),
  parity 점검표·위 Step 1 동작과 Carrot의 차이(I1–I6)·사용자 결정 사항은
  [M1-INPUT-001](CURRENT.md#m1-input-001--carrot-inputimport-parity)이 source of truth다.
  요약: 직접 이미지는 PNG/JPG/JPEG/WebP만(WebP는 PNG로 변환), archive는 ZIP/CBZ/RAR/CBR와 PDF,
  폴더 import와 다중 chapter 일괄 가져오기, 일반 web page URL scan import가 parity다.
- 신규 기능(M1 parity 아님): JFIF(사용자 요청으로 Step 1 보완에서 구현), 7z, GIF/BMP/TIFF/AVIF,
  archive/이미지 URL 직접 다운로드 등. [M5-INPUT-001](../M5_FEATURES/IDEAS.md#m5-input-001--carrot에-없던-input-형식import-방식).

이번 Step 1 검토 보완은 archive/URL/PDF/기타 이미지 구현과 Step 2를 시작하지 않는다.
로컬 실제 데이터의 수동 검증은 Git 제외 `RoverCarrot/test-data/`, 자동화된 소형
배포 가능 fixture는 tracked `RoverCarrot/tests/fixtures/`로 분리한다([사용법](../../../README.md)).

## Coupling 기록 규칙

1. Step에서 발견한 coupling은 먼저 그 Step Result의 **Remaining coupling / follow-up**에 적는다. 모든 coupling을 새 milestone item으로 만들 필요는 없다.
2. 그 coupling이 실제로 M3 pipelining blocker, M4 optimization/runtime 교체 blocker, 또는 별도 사용자 결정이 필요한 architecture 문제가 되면 [Planning index §7](../README.md#7-adding--updating-project-items) 규칙에 따라 **기존 item을 보완**하거나 IDEAS item과 연결한다(예: [M3-STATE-001](../M3_PIPELINING/IDEAS.md#m3-state-001--공유-mutable-state-분리), [M3-TRANS-001](../M3_PIPELINING/IDEAS.md#m3-trans-001--translation-memory-순차-dependency-완화), [M3-RUNTIME-001](../M3_PIPELINING/IDEAS.md#m3-runtime-001--pipelining을-위한-gpu-resource-scheduling)). 중복 item을 만들지 않는다.

## Reference-driven validation

M1은 기존 Carrot Windows implementation의 Linux port다. [M1 원칙](README.md#원칙)("동작 변경은 사용자 결정, 기본은 현재 동작 보존")을 검증 기준으로 구체화하면 각 Step의 correctness oracle은 다음 순서다. Step에 별도 acceptance rule이 있으면 그것이 아래 일반 원칙보다 우선한다.

1. milestone 문서의 명시적 요구사항(Step 정의, CURRENT item, 기록된 사용자 결정)
2. 수정하지 않은 Carrot reference implementation([Reference implementation](../../../AGENTS.md#reference-implementation))
3. 이미 승인된 validation 결과와 known difference(각 Step `Result`, Step validation 문서)

- 구현 전에 Step의 reference source와 observable contract(입력, 출력 field, persistence, error 처리)를 식별한다.
- 가능하면 같은 입력으로 reference와 Rover를 비교하는 differential validation/test를 만든다. 기존 reference artifact를 baseline으로 쓰면 그 출처와 binding을 적고 fresh 실행처럼 표현하지 않는다.
- 문서에 허용된 차이가 없는 observable behavior는 reference와 일치시키는 것이 기본이다. Rover에 맞추려고 reference를 수정하지 않고, fixture 변경·normalization·comparator 축소로 실제 차이를 숨기지 않는다.
- platform/runtime 차이로 exact parity가 불가능하면 차이를 격리하고, 재현 evidence를 남기고, downstream 영향을 확인한다. 임의 tolerance를 추가하지 않고 수용 여부는 사용자 판단(USER_DECISION_REQUIRED)으로 남긴다. 예: Step 2의 [effect bbox 차이 수용](STEP2_VALIDATION.md#effect-bbox-difference-step-2-acceptance).

모든 결과가 byte-exact여야 한다는 뜻은 아니다. 비교 방식은 observable contract에 따라 정한다.

| 비교 방식 | 대상 예 |
|---|---|
| Exact가 기본 | schema, allowed key set, count, order, ID, enum/type, persisted structure, deterministic configuration behavior |
| 원인 분석이 먼저 | floating point, confidence, runtime-dependent geometry, image/model runtime 차이 |
| Semantic contract | 자연어 번역, rendered image, inpainting output 같은 비결정적 생성 결과 |

## Step status와 DONE 조건

Status: `NOT_STARTED` / `IMPLEMENT` / `REVIEW` / `FIX` / `CHECKPOINT_READY` / `BLOCKED` / `DONE`. 의미와 transition은 [State와 transition](#state와-transition)에 있다.

`DONE`은 코드 작성 완료가 아니다. 다음을 모두 만족해야 한다.

- Step scope 구현 완료
- Step Validation 완료([Reference-driven validation](#reference-driven-validation))
- 독립 review 통과(CHECKPOINT_READY: open REQUIRED_FIX·USER_DECISION_REQUIRED 없음)와 사용자의 명시적 승인([사용자 checkpoint 승인](#사용자-checkpoint-승인))
- 필요한 milestone 문서 갱신(이 문서의 Result, Progress 표, [현재 위치](#현재-위치) 표, CURRENT.md의 관련 item `Progress`)
- commit 완료
- push 완료
- Result에 commit, validation 결과, known differences 기록

Step 2~6 Validation의 비교 기준 데이터(기존 run artifact, `hayai-regions.json`, `ocr-bbox-hints.json`, `result.json` 등)는 repo가 아니라 로컬 Carrot data root에 있다([RoverCarrot/AGENTS.md 로컬 전용 데이터](../../../AGENTS.md#로컬-전용-데이터), 위치 확인은 D31).

Step `Result`의 `Progress notes`에는 `DONE`이 아닐 때 한 일, 남은 일, 사용자 답을 기다리는 질문, 작업 branch를 짧게 적는다. `DONE`이 되면 비우거나 요약만 남긴다.

**M1 validation과 M2를 혼동하지 않는다.** M1에서는 구현용 unit/smoke/regression fixture와 test를 에이전트가 만들 수 있다. 사용자가 검토·승인하는 장기 Golden Sample과 benchmark는 [M2](../M2_TEST_SET/README.md)다.

## Open decision / validation register

CURRENT.md의 모든 `Decision / validation needed`와 이 계획 작성 중 확인한 누락 항목을 Step에 배정했다. "해결"은 그 Step에서 결정·검증해야 한다는 뜻이고, "기록"은 그 Step에서 현재 동작을 보존하고 사실만 남기면 된다는 뜻이다. CORE §17의 열린 결정은 한꺼번에 선결하지 않고 관련 Step에서 필요할 때 다룬다.

| # | 항목 | 출처 | Step | 처리 | M1 blocker? | 후속으로 넘길 수 있는가 |
|---|---|---|---|---|---|---|
| D1 | Carrot loader가 project/chapter를 열 때 요구하는 최소 파일·필드 | M1-COMPAT-001 | 1 | 해결(source 분석 → 새 analysis 문서) | **예**(출력 형식의 전제) | 아니오 |
| D2 | config 형식, Carrot `settings.json` import 여부 | M1-CONFIG-001 | 1 | 해결 | 예(Step 1 smoke 전제) | import 여부는 기록 후 Step 8까지 미룰 수 있음 |
| D3 | Carrot이 열 수 있는 출력 형태(Carrot library 구조에 직접 쓰기 / 별도 output + 가져오기) | M1-CONFIG-002 | 1 | 해결(D1 결과 기반) | 예 | 아니오 |
| D4 | persistence 전략과 boundary 범위(CORE §17 #5) | M1-PERSIST-001 | 1 | boundary 해결. 저장 구현은 D1·D3을 만족하는 최소안 | 예(boundary) | 성능 개선은 [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선) |
| D5 | stage 단위 재실행/resume 범위 | M1-CLI-001 | 1 | 최소 범위 해결 | 아니오 | 확장은 Step 8에서 재검토 |
| D6 | progress/timing 출력 형식 | M1-OBS-001 | 1 | 해결 | 아니오 | — |
| D7 | stage result/error 기본 contract, partial failure 표현(CORE §17 #4) | M1-CORE-001 | 1 | 기본 contract 해결. 기존 completed/failed 의미 보존 | 예(모든 stage의 전제) | 상태 세분화는 후속 가능 |
| D8 | Core 구현 언어/runtime과 code hierarchy, dependency direction | Step 1 범위(이 계획) | 1 | 해결. 사용자 판단이 필요한 trade-off면 사용자에게 제시 | 예 | 아니오 |
| D9 | 배포 형태(venv/container/system package), GPU 필수 여부 | M1-RUNTIME-001 | 1 기록 → 2·3·4·6·7에서 runtime별 결정 → 8 확정 | 단계적 | 아니오 | — |
| D10 | 입력 materialization(zip/folder, webp→PNG 등 Carrot import 동작) 범위 | 누락 확인(CORE §1 import) | 1 기록 → 8 확인 | 최소 input contract 해결. Carrot parity 범위는 source trace로 확정해 [M1-INPUT-001](CURRENT.md#m1-input-001--carrot-inputimport-parity) 점검표로 추적(2026-10-02). 구현 Step 배정은 사용자 결정 | 아니오(Step별) | 아니오(M1 완료 전 parity 항목 구현·검증) |
| D11 | 사용자 rule stage(source/translation/format rules)와 review stage를 M1에 포함할지 | 누락 확인([CORE §1](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#1-end-to-end-production-data-flow), [CORE §16](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기)) | 1 기록 → 8 결정 | 사용자 확인 필요 | 아니오(rule 없으면 no-op) | 아니오(M1 완료 전 결정) |
| D12 | detection open decisions(DETECTION §25): raw mask 보존, cache 범위, SFX 범위, 재실행 semantics, ONNX 구현 언어, presentation 기본값 분리, source direction | M1-DETECT-001 | 2 | SFX 범위·재실행 semantics·ONNX 언어는 해결(현재 동작 보존 기본). raw mask 보존·cache는 기록 | 아니오 | raw mask/cache는 [M4-DETECT-001](../M4_OPTIMIZATION/IDEAS.md#m4-detect-001--같은-원본-raster의-koharu-raw-inference-재사용) |
| D13 | raw OCR 보존과 sanitize 위치(CORE §17 #1) | M1-OCR-001 | 3 | 해결(현재 동작 보존 기본, 변경 시 사용자 결정) | 아니오 | — |
| D14 | 번역 누락 block 처리(CORE §17 #2) | M1-CORE-001 | 4 | 기록(현재 동작 보존) | 아니오 | 변경은 별도 사용자 결정 |
| D15 | AI glossary 자동 누적(CORE §17 #8) | M1-CORE-001 | 4 | 기록(현재 동작 보존) | 아니오 | [M4-TRANS-010](../M4_OPTIMIZATION/IDEAS.md#m4-trans-010--memory-correction과-provenance) |
| D16 | managed server launch/config provenance, 요청별 work-context snapshot 저장, TR §16의 다른 미결정 목록 | M1-TRANS-001, M1-PERSIST-001 | 4 | 해결 | 아니오 | TR §16 중 동작 변경 항목은 M4 |
| D17 | 자동 font matching(autoFont) 지원 범위 | 누락 확인([INITIAL §7](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#7-초기-rovercmt에서-제외-가능한-항목)) | 5 | 사용자 확인 필요. 현재 사용자 기본 설정은 autoFont=false | 아니오 | — |
| D18 | Typography/Layout 전용 analysis 부재 | 누락 확인 | 5 | Step 5 시작 시 source trace로 보완 | 아니오 | — |
| D19 | INPAINTING §17 UNDECIDED: bubble prepass 유지, 약한 변경 판정 품질 gate, GPU owner, `sourceEraseScale` 기본 사용 | M1-INPAINT-001 | 6 | prepass·`sourceEraseScale`는 현재 동작 보존으로 해결. gate는 기록 | 아니오 | GPU 정책 확장은 M3 |
| D20 | 번역 누락 block의 erase 처리(CORE §17 #3, INPAINTING §17 #1) | M1-CORE-001, M1-INPAINT-001 | 6 기록 → 8 확인 | 현재 동작 보존(사용자 결정 2026-10-01) | 아니오 | 변경은 별도 사용자 결정 |
| D21 | GPU ownership(CORE §17 #6) | M1-INPAINT-001, M1-TRANS-001 | 4·6·8 | 기존 handoff 순서 보존 | 아니오 | [M3-RUNTIME-001](../M3_PIPELINING/IDEAS.md#m3-runtime-001--pipelining을-위한-gpu-resource-scheduling) |
| D22 | Skia Linux smoke, isolated-process memory, font capability, `_047` 등 source-match 차이 | M1-RENDER-001 | 7 | 해결 | Skia 방향에는 예, M1 전체에는 아니오(Playwright fallback 있음) | — |
| D23 | 출력 형식(PNG/JPEG, source 형식 보존 등 export 동작) | 누락 확인([CORE §1](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#1-end-to-end-production-data-flow) Renderer/Export) | 7 | 해결 | 아니오 | — |
| D24 | Translation ↔ Erase 병렬 경로의 Linux 기능적 동등성 | M1-CORE-002 | Post-M1 | **Superseded / Deferred** ([2026-10-03 baseline 결정](CURRENT.md#m1-baseline-decision-2026-10-03)) | 아니오 | [M3-SCHED-001](../M3_PIPELINING/IDEAS.md#m3-sched-001--기존-translation--erase-병렬을-넘어선-추가-stage-overlap) |
| D25 | 실제 Windows Carrot에서 RoverCMT output open/use | M1-COMPAT-001 | 8 | 해결 | **예**(M1 완료 조건) | 아니오 |
| D26 | 대표 실제 page로 최소 E2E | M1-CORE-001 | 8 | 해결 | 예(M1 완료 조건) | 아니오 |
| D27 | reproducibility 수준(CORE §17 #10, CORE §10 L1–L3) | M1-PERSIST-001 | 1 기록 → 8 확인 | 기록 | 아니오 | — |
| D28 | RENDERER_CANDIDATE_ANALYSIS §7 기각 후보를 사용자 REJECTED로 기록할지 | M1-RENDER-001 | 어느 Step과도 무관 | 사용자 확인 | **아니오** | 언제든 |
| D29 | Rover Output 이식을 어느 Step에서 구현할지 | M1-PERSIST-002 | 4 구현 → 8 통합(기본안) | 기본안 유지. export는 번역 저장 상태에서 트리거되므로 translation persistence가 생기는 Step 4에서 export를 구현하고, 출력 경로·기본 입출력 디렉터리와 전체 output 흐름은 Step 8에서 통합 검증한다 | 아니오 | 아니오(M1 scope) |
| D30 | 병렬 경로의 별도 장치 vs 같은 GPU 공유 전제 | M1-CORE-002 | Post-M1 | **Superseded / Deferred** ([2026-10-03 baseline 결정](CURRENT.md#m1-baseline-decision-2026-10-03)) | 아니오 | [M3-RUNTIME-001](../M3_PIPELINING/IDEAS.md#m3-runtime-001--pipelining을-위한-gpu-resource-scheduling) |
| D31 | 로컬 Carrot data root 위치(비교 기준 데이터) | Step 2–6 Validation | 2 시작 전 | Step 2에서 read-only filesystem/model/chapter-page-run binding으로 식별(2026-10-02); [ignored context와 재현](STEP2_VALIDATION.md#reference-binding-d31) | 예(Step 2–6 비교 검증의 전제) | 아니오 |
| D32 | Gemma 4 26B 세부 구성: quantization, economy26b vs qat26b, QAT/MTP 여부, mainline/SPEED 및 CUDA12/13 profile | 2026-10-03 user decision; [source trace](../../analysis/TRANSLATION_MANAGED_BACKEND_SOURCE_TRACE.md#source-evidence) | 4 시작 전 | **OPEN** — backend=managed gemma, 모델 계열=26B만 확정. 변형을 임의 선택하지 않음 | 예(Step 4 exact configuration 검증) | 아니오 |
| D33 | managed llama-server Linux binary·runtime packaging·preflight/ABI·process tree 종료·Windows 경로 적응 | M1-TRANS-001, M1-RUNTIME-001; [Windows coupling](../../analysis/TRANSLATION_MANAGED_BACKEND_SOURCE_TRACE.md#windows-coupling) | 4 | **OPEN** — catalog에 Linux 없음. Linux 대체 build/binary/배포·종료 방식은 사용자 결정과 실검증 필요; 후보 선택·구현 없음 | 예(managed Linux lifecycle 및 M1 완료) | 아니오 |

---

## Step 1 — Core Architecture, Contracts & CLI Adapter

- **Status:** DONE
- **Goal:** Linux RoverCMT의 최소 Core architecture와 실행 골격을 만들고, 이후 stage가 붙을 contract/boundary를 실제 코드로 검증한다. M1에서 가장 중요한 초기 checkpoint다.
- **Scope:**
  1. Carrot loader/import 경로 선행 분석: Windows Carrot이 RoverCMT output을 open/use하는 데 필요한 최소 project/output contract 확인(D1). 결과는 새 analysis 문서(`docs/analysis/`)로 남기고 M1-COMPAT-001에 링크한다.
  2. config 형식 결정(D2), input/output path contract(D3, D10)
  3. Core programmatic/public boundary와 CLI adapter, Linux entry point([A1](#a1-rovercmt는-cli-only-application이-아니다))
  4. pipeline/stage 기본 contract, stage result/error 표현(D7)
  5. 최소 orchestration skeleton(Carrot stage 순서를 표현할 수 있는 수준. [A6](#a6-stage-implementation과-execution-policy를-분리하는-방향))
  6. progress/timing infrastructure(D6)
  7. persistence boundary(D4)와 D3을 만족하는 최소 output 구현
  8. 최소 code hierarchy와 dependency direction(D8): `CLI → Core public boundary → Pipeline/orchestration → Stage boundaries → runtime/provider implementations`
  9. dummy/no-op stage로 구성한 minimal pipeline을 Linux CLI로 실행하는 smoke
  10. repository 배치와 개발 명령: Rover 코드는 `RoverCarrot/` 아래에 둔다. Rover 전용 build/test/lint 명령을 정해 [RoverCarrot/AGENTS.md CI / 테스트 정책](../../../AGENTS.md#ci--테스트-정책)에 기록한다. 루트 Carrot eslint·check가 `RoverCarrot/` 코드를 검사하지 않도록 처리한다(루트 `src/`는 수정하지 않는다. 루트 ignore 설정 변경만 허용)
- **Explicit non-goals:**
  - 실제 Detection/OCR/Translation/Inpainting/Renderer 구현
  - 전체 M1을 상상해 빈 interface/factory/file을 대량으로 만드는 것. 필요한 최소 skeleton만 만들고 Step 2부터 실제 stage를 붙이며 검증·확장한다
  - Carrot loader contract 확인 전에 새 persistence architecture를 확정하는 것
  - HTTP/RPC server, plugin system, scheduler framework
  - 성능 최적화
- **Related M1 items:** [M1-CORE-001](CURRENT.md#m1-core-001--linux-core-pipeline-port), [M1-CONFIG-001](CURRENT.md#m1-config-001--configsettings-파일-기반-설정), [M1-CONFIG-002](CURRENT.md#m1-config-002--inputoutput-경로-config화), [M1-CLI-001](CURRENT.md#m1-cli-001--bashcli-실행), [M1-OBS-001](CURRENT.md#m1-obs-001--stage-진행상황과-소요시간-실시간-표시), [M1-COMPAT-001](CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability), [M1-PERSIST-001](CURRENT.md#m1-persist-001--persistence와-data-contract-parity), [M1-RUNTIME-001](CURRENT.md#m1-runtime-001--linux-runtimemodel-의존성-교체적응)
- **Prerequisites:** 없음. Linux 실행 환경(또는 WSL 등 Linux 호환 환경)이 필요하다. 시작 시 Rover PC WSL2 준비 여부를 확인하고, 준비되지 않았으면 `BLOCKED`로 둔다([실행 환경](../../../AGENTS.md#실행-환경)).
- **Related analysis:**
  - [CORE §2 Canonical Entity Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#2-canonical-entity-model), [§9 Persistence and Artifact Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#9-persistence-and-artifact-model) — Carrot이 여는 파일 구조. D1 분석의 출발점.
  - [CORE §6 Stage Contract Matrix](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#6-stage-contract-matrix), [§11 Failure Semantics](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#11-failure-semantics), [§13 Proposed Minimal RoverCMT Core Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#13-proposed-minimal-rovercmt-core-model), [§14 Candidate Persistence Strategies](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#14-candidate-persistence-strategies), [§15 Minimal E2E Contract](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#15-minimal-e2e-contract) — stage contract, 실패 의미, model·persistence 후보(모두 확정 아님).
  - [INITIAL_MIGRATION_ANALYSIS §3.1](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#31-input--orchestration--persistence--adaptable), [§6 재사용 우선 후보](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#6-재사용-우선-후보) — orchestration 재사용 범위.
- **Source areas to inspect:**
  - Carrot loader/저장: `src/main/libraryStore/libraryFiles.ts`, `src/main/libraryStore/chapterRecords.ts`, `src/main/libraryStore/workContextFiles.ts`, `src/main/libraryStore/pageWorkflowMutations.ts`, `src/shared/libraryTypes.ts`, `src/shared/workContextTypes.ts`
  - import: `src/main/libraryStore/importPageMaterialize.ts`
  - orchestration과 stage 목록: `src/main/application/pageWorkflowService.ts`, `src/main/pageWorkflow/pageWorkflowRuntime.ts`, `src/shared/pageWorkflowPolicy.ts`, `src/shared/pageWorkflowTypes.ts`
- **Open decisions to resolve:** D1, D2, D3, D4(boundary), D5, D6, D7, D8. 기록: D9, D10, D11, D27.
- **Architecture/coupling concerns:**
  - Carrot은 page 결과와 translation memory를 한 transaction으로 저장한다([TR-LLM §10.1](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#101-workflow의-저장-의미-fact)). persistence boundary는 이 commit 의미를 나중에 표현할 수 있어야 한다.
  - stage는 page/block state를 공유한다. Step 1의 stage contract는 shared state를 허용하되 read/write를 드러낼 수 있어야 한다([A4](#a4-없애지-못한-coupling은-명시적으로-보이게-한다)).
  - 실행 순서는 stage-major다([TRANSLATION_PIPELINE §1.1](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#11-stage-진입)). M1 orchestration은 기존 순차 순서를 표현한다. 병렬 경로는 Post-M1이다([2026-10-03 baseline 결정](CURRENT.md#m1-baseline-decision-2026-10-03)).
- **Validation:**
  - Linux에서 CLI 실행
  - config load
  - input/output path resolution
  - CLI가 programmatic Core boundary를 호출함(CLI 없이 같은 boundary를 코드에서 호출하는 test 포함)
  - dummy/minimal pipeline 실행과 stage progress/timing 표시
  - success와 failure result 반환
  - persistence/output boundary smoke(D3 형태로 최소 output 생성)
  - RoverCMT 코드가 parent Carrot runtime source를 직접 import하지 않음(검사 명령으로 확인)
- **Completion criteria:**
  - D1 결과가 analysis 문서로 남고 M1-COMPAT-001에 링크됨
  - D2–D8 결정과 이유가 Result 또는 관련 CURRENT item에 기록됨(사용자 판단이 필요한 항목은 사용자 답을 받았거나 `BLOCKED` 사유가 명시됨)
  - Rover 코드가 `RoverCarrot/` 아래에 있고, Rover 전용 build/test/lint 명령이 RoverCarrot/AGENTS.md에 기록되고, 루트 Carrot eslint·check가 `RoverCarrot/` 코드를 검사하지 않음(루트 `src/` 무변경)
  - 위 Validation 통과, [DONE 조건](#step-status와-done-조건) 충족
  - **Checkpoint:** Step 1 완료 후 다음 Step으로 자동 진행하지 않는다. 이 architecture가 이후 모든 Step의 기반이므로 사용자/검토자가 결과를 확인한다.
- **Result:**
  - Status: DONE — 구현·validation·commit·push 완료(2026-10-02).
  - Progress notes: branch `main`; 사용자 수동 검증·architecture checkpoint 승인 완료(2026-10-02). 다음은 Step 2.
  - Commit: [`4c63e4631bbaa5fb4114d8f3ecf996de30cf145e`](https://github.com/360F/RoverCMT/commit/4c63e4631bbaa5fb4114d8f3ecf996de30cf145e) — `feat(rover): add M1 Step 1 core and CLI skeleton`. push 후 local/remote SHA 일치 확인; 이 DONE checkpoint는 후속 docs commit에 기록.
  - Validation result: WSL2 Ubuntu 26.04.1, Node 24.21.0/npm 11.19.0/Python 3.14.4. fetch 후 시작 local/remote HEAD `4f808e213cd0ed5042f25079ab85ab90c5f056a5`, clean main. Git 작성자 정보를 사용자에게 받아 repo-local 설정; Windows GCM의 기존 인증으로 push 성공(토큰 출력/저장 없음). `npm run check`(typecheck/lint/build 및 9 unit/CLI smoke), `npm run check:boundaries`; 루트 ESLint/Prettier ignore 및 루트 TS include scope와 reference src 무변경 확인. Node child process와 GPU 접근은 sandbox 밖에서 검증.
  - D1: [loader/output contract 분석](../../analysis/CARROT_LOADER_OUTPUT_CONTRACT.md). strict Carrot index/work/chapter/page 최소 필드와 identity/path scope, copied path relocation 및 GUI share ZIP contract 구분. 실제 CLI로 PNG 복사와 chapter JSON 저장·재읽기 검증; dummy run은 page/chapter idle 유지.
  - D2: versioned JSON config, config 파일 기준 상대 경로; unknown field 거부. Carrot settings import는 Step 8까지 보류. 2026-10-02 사용자 요청으로 변경: 고정 `config/`(`example.json` tracked, `local.json` ignored), config `input`/`output`은 기본값이고 CLI `--input`/`--output`이 우선, 상대경로는 CWD 기준([README](../../../README.md)). 2026-10-02 사용자 요청으로 다시 변경: 사용자 config는 project root 고정 `config/config.toml`(TOML, 없으면 내장 template 생성) 하나, `--config` 제거.
  - D3: 기존 data root를 건드리지 않는 신규 output library root. Windows 별도 data root로 복사 후 source relocation 활용; 실제 open/use는 Step 8. GUI share ZIP export는 현재 구현하지 않음.
  - D4: chapter JSON + persistence port, single-file rename 및 index-last publication. 사용자 승인(2026-10-02). 페이지+memory 원자 commit은 Step 4에서 구현·검증; 현재 port는 page-only이며 multi-file durability를 주장하지 않음.
  - D5: config `stages`로 subset 실행, 매 실행 신규 output. saved-state resume/overwrite는 구현하지 않고 Step 8 재검토.
  - D6: stderr JSONL 실시간 page×stage start/end 및 wall ms, stdout structured run result, output `runs/<runId>.json`. 사람도 stage ID와 timing을 즉시 볼 수 있음. 2026-10-02 사용자 요청으로 변경: 터미널은 stage 진행률/PASS/FAIL만 표시하고 JSONL event/timing은 `logs/log_all.log`, 실패·오류는 `logs/critical.log`(각 10/5 MiB, 줄 단위 trim). run JSON 저장은 유지([README](../../../README.md)).
  - D7: stage completed/empty/failed, failed에서도 partial page 반환 가능; thrown exception 변환. page issue는 run partial, setup/persistence 인프라 예외는 failed. 실패 page의 후속 stage 생략. dummy stage 성공을 번역 completion으로 저장하지 않음.
  - D8: 사용자 승인 Node.js/TypeScript; CLI composition → Core `run` → pipeline → stage contracts. 독립 package/lock/build/test/lint; framework/factory registry 없음.
  - D9: Step 1은 Node runtime; 검토 보완에서 독립 runtime dependency `sharp`를 pin하여 이미지 decode 검증 추가. uv/Docker 미확인·미설치; ONNX/Python/Rust/CUDA 설치·pin은 해당 Step. 실제 `nvidia-smi`: RTX 5070 Ti 16GB, CUDA 표시 13.2 (문서의 사용자 보고 5090/13.4와 다름; 환경 규정은 변경하지 않음).
  - D10: 사용자 검토 보완으로 PNG/JPG/JPEG/WebP/JFIF 단일 파일·mixed directory, full decode/format 일치·크기 검증 + 원본 bytes 복사 지원. 상세와 archive/URL 장기 범위는 [Input Materialization Direction](#input-materialization-direction).
  - D11: skeleton은 source/translation/format rules 및 review 순서 표현 가능; 실제 포함 여부 사용자 결정 Step 8.
  - D27: config, page IDs, copied source, run event/timing 기록. exact model/request/runtime provenance는 실제 stage Step에서 확장; M2 Golden/benchmark 아님.
  - Known differences: no-op providers만 있음; 실제 번역/최종 raster 없음. partial input publication 실패 시 신규 디렉터리를 보존하고 자동 정리하지 않음. 기존 출력/링크는 거부. Linux → Windows interoperability는 source 분석과 최소 출력 smoke까지만 검증.
  - Remaining coupling / follow-up: shared chapter/page state + chapter 전체 rewrite; 순차 stage-major 정책은 pipeline 소유. provider는 page copy 반환 및 reads/writes/resources 선언. translation memory 순서와 page/context transaction 구현은 Step 4; Translation↔Erase overlap/GPU handoff는 Step 8이라는 당시 계획은 [2026-10-03 baseline 결정](CURRENT.md#m1-baseline-decision-2026-10-03)으로 superseded; Step 8은 순차 handoff 검증, overlap은 Post-M1. [M3-STATE-001](../M3_PIPELINING/IDEAS.md#m3-state-001--공유-mutable-state-분리), [M3-TRANS-001](../M3_PIPELINING/IDEAS.md#m3-trans-001--translation-memory-순차-dependency-완화), [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선) 기존 item과 연결; 신규 최적화 구현 없음.
  - User review supplement (2026-10-02): 실제 JPG 4페이지가 `No PNG inputs`로 실패한 문제를 지원 형식 확대/실제 decode로 수정. 인자 없는 `npm run smoke` Usage error를 repository fixture 기반 CLI validation으로 수정. 손상된 기존 1×1 PNG test fixture를 유효한 합성 PNG로 교체. tracked 소형 fixture와 Git 제외 `test-data/input/`, `test-data/output/` 분리; README에 폴더 복사/config/신규 output 사용법 기록. 실제 사용자 만화는 commit하지 않음.
  - Supplement validation: `npm run check`(typecheck/lint/build, 21 tests), `npm run smoke`(12 tests), `npm run check:boundaries`; PNG/JPG/JPEG/WebP/JFIF/case-insensitive 단일 입력, mixed natural order, 크기/bytes 복사, malformed/truncated/mismatch/unsupported 처리 및 explicit CLI config 검증. `git check-ignore`로 임의 중첩·dotfile·내부 ignore의 unignore 시도도 제외됨을 확인. root reference source 무변경. 보완 commit은 `86749346` — `fix(rover): support image inputs and repository smoke validation`.
  - Follow-up history (git history 확인, 2026-10-02): 최초 구현 `4c63e463` 유지. `77561d35` 완료 checkpoint 기록 → `86749346` input/smoke remediation → `ebf7466a` Carrot input/import parity 범위 기록 → `2003514e` 내부 디렉터리 `RoverCarrot/` rename → `5aa082e4` 고정 config 경로와 `--input`/`--output` override → `e99c9c76` single TOML `config/config.toml`, `--config` 제거, 사람용 progress/PASS/FAIL과 `logs/` 분리 → `030b2df5` 상세 로그 `rovercmt.log` → `log_all.log` rename.
  - User checkpoint (2026-10-02): 실제 JPG 4장 수동 검증 완료, 원본/output byte preservation 및 기존 output overwrite 없이 FAIL 확인; 사용자 Step 1 승인 완료.
  - Follow-up items: Step 2 시작 시 D31 로컬 Carrot data root 위치 확인.

## Step 2 — Detection / Koharu

- **Status:** DONE
- **Goal:** Carrot Detection을 Linux RoverCMT stage로 이식하고, Step 1 architecture에 첫 실제 stage를 붙여 contract를 검증한다.
- **Scope:** Koharu layout ONNX runtime(Linux), portable image decode/input, preprocessing, inference, 기존 결정적 후처리(`buildHayaiRegionManifest`), region/block 출력, `ocrSubdivision` 등 OCR이 쓰는 정보, Rover stage contract 연결.
- **Explicit non-goals:** 반복 Koharu 추론 제거, raw inference 재사용 등 [M4-DETECT-001](../M4_OPTIMIZATION/IDEAS.md#m4-detect-001--같은-원본-raster의-koharu-raw-inference-재사용) 범위. 휴면 상태인 `recognitionBboxes` 경로의 재설계. anime-text-yolo 등 production 밖 detector.
- **Related M1 items:** [M1-DETECT-001](CURRENT.md#m1-detect-001--koharu-layout-onnx-linux-runtime), [M1-RUNTIME-001](CURRENT.md#m1-runtime-001--linux-runtimemodel-의존성-교체적응), [M1-CORE-001](CURRENT.md#m1-core-001--linux-core-pipeline-port)
- **Prerequisites:** Step 1 DONE과 사용자 checkpoint 확인.
- **Related analysis:**
  - [DETECTION §1 Production Detection Flow](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#1-production-detection-flow-fact), [§3 Image Decode / Preprocessing](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#3-image-decode--preprocessing), [§5 Detection Postprocessing](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#5-detection-postprocessing-buildhayairegionmanifest), [§6 Block Creation and Defaults](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#6-block-creation-and-defaults), [§7 Recognition Geometry](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#7-recognition-geometry)
  - [DETECTION §12 Input Contract](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#12-detection-input-contract), [§13 Output Contract](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#13-detection-output-contract), [§22 Linux Runtime Smoke Test Plan](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#22-linux-runtime-smoke-test-plan-미실행), [§24 Recommended Migration Boundary](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#24-recommended-migration-boundary), [§25 Open Decisions](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#25-open-decisions-for-user)
- **Source areas to inspect:** `src/main/textDetection/hayaiRegionPrepass.ts`, `src/main/textDetection/pageTextRegionDetector.ts`, `src/main/textDetection/hayaiRegionGeometry.ts`, `src/main/textDetection/hayaiOcrSubdivision.ts`, `src/main/bubbleLayout/detector.ts`, `src/main/pageWorkflow/pageWorkflowOcr.ts`(`detectWorkflowBlocks`).
- **Open decisions to resolve:** D31(로컬 data root 위치; 사용자 지침에 따라 filesystem read-only 식별 완료), D12(SFX 범위, 재실행 semantics, ONNX 구현 언어). 기록: D12 raw mask 보존·cache 범위, D9의 ONNX Runtime 배포 형태.
- **Architecture/coupling concerns:**
  - detection은 `blocks`를 통째로 교체하고 이후 stage 필드를 버린다([CORE §3 Page Data Lifecycle](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#3-page-data-lifecycle)).
  - 같은 Koharu model을 Step 5 layout과 Step 6 erase prepass도 쓴다. runtime을 이 세 용도가 공유할 수 있는 boundary로 둔다(결과 재사용은 M4).
  - Carrot은 detection 결과를 번역용 공용 경로(`overlayItemToBlock`)로 block에 넣는다. presentation 기본값 결합 여부를 Result에 기록한다.
  - Step 1 abstraction이 과도하거나 부족하면 최소한으로 수정하고 이유를 Result에 기록한다.
- **Validation:** 고정 입력(기존 run artifact의 원본 page)으로 기존 `hayai-regions.json`과 region 수, bbox, 순서, subdivision 등 필요한 metadata를 비교한다(DETECTION §22 S0–S3).
- **Completion criteria:** DetectionResult가 Rover stage boundary를 통해 다음 stage(OCR)가 쓸 수 있는 상태로 저장됨. ONNX inference 성공만으로는 DONE이 아니다. [DONE 조건](#step-status와-done-조건) 충족.
- **Result:**
  - Status: DONE — 구현·validation·commit·push 완료, 사용자 checkpoint 승인(2026-10-03).
  - Progress notes: branch `main`; 사용자 checkpoint 승인 완료(2026-10-03). 작업 시작 HEAD(각각 clean local/remote): Phase B `1859ad91`(Step 1 승인·문서 동기화 commit), strict persistence 수정 `17e94c03`, Low 지적 수정 `644c7ad1`. 다음은 Step 3(미시작).
  - Commit: Step 2 완료 commit [`4e8059e4`](https://github.com/360F/RoverCMT/commit/4e8059e4c071a22bb9e474392cf3a99147cada5a) — `fix(rover): close Step 2 checkpoint Low findings`. 사용자 checkpoint 승인(2026-10-03)의 검증 기준 HEAD이며, 이 DONE 기록은 후속 docs commit에 있다. 구현 commit [`4a435446`](https://github.com/360F/RoverCMT/commit/4a435446) — `feat(rover): implement Koharu CPU detection with internal smoke injection`(독립 검증 대기 상태로 commit/push), strict persistence 수정 commit `644c7ad1`. Phase A 문서 동기화 commit은 `1859ad91`.
  - Validation result: `npm run check`(46 tests; 원 구현 40, 독립 검증 수정 44), `npm run smoke`(15 tests), boundaries PASS. S0/S1 Linux x64 ORT 1.27.0 CPU native load·model filename/148,442,003 bytes/전체 SHA·metadata 확인; isolated `npm ci --ignore-scripts` 성공. S2 실제 원본으로 추론 성공. S3 dialogue/effect 6/9, type/order/provenance 일치, dialogue bbox exact, effect 2개 4.5px 차이(effect-only, Step 2 acceptance에서 수용). IoU min/mean/max 0.959525094441446 / 0.996616066806934 / 1. S4 subdivision mode/count/box/order exact. 실제 사용자 JPG 4장 Detect PASS·block persistence·session 1회 재사용·기존 data bytes 보존. [재현 명령·artifact binding·측정 전체](STEP2_VALIDATION.md).
  - Independent-review correction: 실제 root strict schema로 reference/Step 1/새 Step 2 PASS, 구 Step 2 58 issues FAIL 재현. 허용 persistence 필드·subdivision 회귀 test 추가. blank Koharu unset/stage 선택, reference bbox clamp/연산순서(4페이지 33 block 미세 보정), validator order/provenance 분리·Usage, scoped adm-zip override, Electron platform evidence 정정. S2–S4 actual manifest 이전 결과 exact; graphOptimizationLevel `all` 유지. fresh 4페이지 10/2/10/20 blocks·strict PASS, model-less clean check 44/smoke 15/boundaries PASS. [전체 수정·bbox 전후 기록](STEP2_VALIDATION.md#independent-review-correction-h1m1l1l2l4l5l6).
  - Checkpoint finishing(2026-10-03): persisted strict test에 page·workflowOrigin exact key 비교 추가(L1 mutation `workflowOrigin.regionId`/`page.detectionDiagnostics`: 이전 helper 44/44 통과 → 각 46개 중 8개 실패). validator terminal summary에 count/type/order(status gate)와 provenance/subdivision(정보성, status·exit code 불변) 표시 — 기존 정책 유지. STEP2_VALIDATION 표현 정정(수정 전 strict FAIL output, 최적화 수준 단일 측정, DirectML 원인 표현). [상세](STEP2_VALIDATION.md#checkpoint-finishing-fixes-2026-10-03).
  - D9/D12: exact Node ORT in-process CPU; session run 내 재사용, 종료 release. SFX review만 보존, staged OCR/자동 translation 제외; internal skip/overwrite만, CLI 신규 flag 없음. raw masks/cross-stage inference cache 없음. sourceDirection horizontal과 presentation defaults 유지.
  - D31: filesystem read-only 발견 및 model identity/개발 root의 chapter-page-run binding으로 `<CARROT_DATA_ROOT>`와 `<KOHARU_MODEL>` 식별. 개인 절대경로는 ignored `test-data/validation/m1-step2/validation-context.json`에만 저장.
  - Known differences: 동일 Electron tensor로도 confidence 차이와 effect 경계 2개 +4.5px 차이. effect 차이는 Linux ORT CPU graph optimization `all`/`extended`에서 재현되며, reference manifest에 execution provider 기록이 없어 DirectML 생성 여부가 확인되지 않았으므로 원인을 단정하지 않음. Dialogue bbox는 exact; effect-only 차이로 현재 Step 2 acceptance에서 수용(사용자 결정 2026-10-03, 현재 Step 2 dialogue block·OCR/translation 경로 영향 없음 범위). [Acceptance 범위](STEP2_VALIDATION.md#effect-bbox-difference-step-2-acceptance). sharp 일반 Lanczos3가 class를 바꾸던 문제는 Chromium fixed-point resize 이식으로 수정(실제/합성 PNG tensor exact). 모든 JPEG/CMYK/ICC/alpha decode parity를 주장하지 않음. 나머지 stage는 no-op.
  - Remaining coupling / follow-up: shared page/block state와 chapter rewrite 유지. model/session은 run-owned adapter, Detection stage는 real manifest를 읽어 blocks/review/geometry에 기록. Page에 optional blockOrder/review, config에 models.koharu. 독립 검증에서 발견된 invalid partial pageWorkflow와 block의 Rover-only provenance 3개 키는 제거. 임계값/geometry 정책 변경 없음; dialogue provenance는 runtime manifest에 유지, strict record 밖 artifact persistence와 empty-result marker(full receipt 필요)는 후속 과제. [boundary·source 차이·결정 기록](STEP2_VALIDATION.md#boundary-and-preserved-behavior).
  - User checkpoint (2026-10-03): `4e8059e4` 검증 결과 기준으로 사용자 Step 2 승인 완료. Known differences의 effect bbox +4.5px 차이는 Step 2 acceptance에서 수용된 상태로 유지.
  - Follow-up items: M4 raw inference 최적화 미구현.

## Step 3 — OCR / Hayai

- **Status:** REVIEW
- **Goal:** HayaiOCR Linux worker와 Rover adapter를 이식한다.
- **Scope:** Linux Python worker, pinned model/runtime, region manifest 입력, OCR 실행, normalization/sanitize, OCR 결과 → block binding, `ocrSubdivision` 관련 기존 동작, `sourceText` 생성, stage/runtime boundary.
- **Explicit non-goals:** VLM 단독 OCR+Translation 통합([M4-TRANS-001](../M4_OPTIMIZATION/IDEAS.md#m4-trans-001--hayai-ocr--vision-translation을-vision-llm-단독-ocrtranslation으로-통합)). PaddleOCR legacy, ROCm, Windows managed Python. 성능 최적화.
- **Related M1 items:** [M1-OCR-001](CURRENT.md#m1-ocr-001--hayaiocr-linux-runtime), [M1-RUNTIME-001](CURRENT.md#m1-runtime-001--linux-runtimemodel-의존성-교체적응)
- **Prerequisites:** Step 2 DONE(manifest 입력). 기존 run artifact만으로 단독 smoke는 먼저 해볼 수 있다.
- **Related analysis:**
  - [OCR §8 Input / Output Contract](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#8-ocr-input--output-contract), [§9 Downstream Dependencies](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#9-downstream-dependencies), [§12 Linux Runtime Smoke Test Plan](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#12-linux-runtime-smoke-test-plan), [§13 Recommended Migration Boundary](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#13-recommended-migration-boundary)
  - [TR-LLM §11 OCR's Actual Role](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#11-ocrs-actual-role) — 현재 translation contract는 `sourceText`를 구조적으로 요구한다.
- **Source areas to inspect:** `src/main/runtime/hayai-bboxes.py`, `src/main/pageWorkflow/pageWorkflowOcr.ts`(`prepareWorkflowOcrInput`, `applyWorkflowOcrResult`), `src/main/runtime/prompts/ocr-text.cjs`(`sanitizeOcrTextForPrompt`).
- **Open decisions to resolve:** D13(raw OCR 보존과 sanitize 위치. 기본은 현재 동작 보존, 바꾸려면 사용자 결정). 기록: D9의 Python runtime 배포 형태.
- **Architecture/coupling concerns:** OCR은 detection 결과(manifest)를 읽고 `sourceText`·`workflowOrigin`을 쓴다. `sourceText`는 translation, typography, erase-scale, renderer source-match가 모두 쓰는 공유 필드다([CORE §4](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#4-block-data-lifecycle), [§7](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#7-dependency-graph-필드-단위)). Carrot은 OCR batch 결과를 stage 동안 메모리에 모아 둔다([CORE §12](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#12-performance-state-accumulation-map)).
- **Validation:** 고정 region manifest와 원본 raster로 기존 `ocr-bbox-hints.json`의 OCR text와 Rover normalized `sourceText`를 region별로 비교한다(OCR §12 S3–S4). 차이는 판정이 아니라 기록 대상이다.
- **Completion criteria:** OCR 결과가 block에 binding되어 Step 4 translation 입력으로 쓸 수 있음. [DONE 조건](#step-status와-done-조건) 충족.
- **Result:**
  - Status: REVIEW (2026-10-03, 독립 review 대기)
  - Progress notes: implementation(Codex) + orchestrator 1차 검증·GPU 검증(Claude) 완료, pre-review rework 1회(durable runtime, CPU-only thread env, comparator count/unbound 기록). D31은 설치 앱 data root로 재binding(2026-10-03 user decision). Branch `main`.
  - Commit: work `044c5743`
  - Validation result: [STEP3_VALIDATION.md](STEP3_VALIDATION.md). check 54/54, smoke 15/15, boundaries PASS, Python 11/11; CPU differential 3p/21 exact; GPU(cu130, RTX 5090) differential 46p/261: reference worker == Rover worker, 정규화 exact, 저장 Carrot hints text 261/261, sourceText 256/256(5 unbound); 4-page CPU/GPU CLI PASS(42 blocks); strict schema PASS
  - Known differences: 관찰된 non-text/text 차이 없음. 승인 대기 known difference 없음
  - Remaining coupling / follow-up: OCR은 page/block state와 `workflowOrigin`을 읽고 `sourceText`·`recognitionSegments`·`ocrFailure`를 쓴다. batch 결과를 stage 동안 메모리에 보관(Stage.prepare), detector release 후 실행, process close 후 다음 stage. 실제 subdivided/recovered/failed Hayai 사례 미검증(reference corpus에 없음). venv/HF cache는 Git 제외 `test-data/runtime/`에 provision(D9 기록)
  - Follow-up items: —

## Step 4 — Translation

- **Status:** NOT_STARTED
- **Goal:** 현재 production translation semantics를 Linux Core로 이식한다.
- **Scope:** managed llama-server(`gemma`), Gemma 4 26B model/runtime 준비·launch/preflight/readiness/stop·page별 endpoint session, 내부 OpenAI-compatible client, 현재 prompt/context 구성(원본 page 이미지 포함), OCR candidate/`sourceText` grounding, work context(glossary, characters, story memory, 이전 화 story pages), response parsing, block mapping/merge, retry/error 처리, 현재 memory commit semantics.
- **Explicit non-goals:** [M4 Translation IDEAS](../M4_OPTIMIZATION/IDEAS.md#translation) 전부(prompt 축소, Previous pass 중복 제거, output schema 축소, page-context trailer 최적화, image resize/re-encode, cache-friendly ordering, VLM 단독 OCR, memory 재설계). Translation ↔ Erase 병렬 실행·GPU scheduling·vLLM·단일 5090 최적화(Post-M1, [2026-10-03 baseline 결정](CURRENT.md#m1-baseline-decision-2026-10-03)). Codex provider, fixed-block/group review 경로([TRANSLATION_PIPELINE §16](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#16-recommended-migration-boundary)).
- **Related M1 items:** [M1-TRANS-001](CURRENT.md#m1-trans-001--openai-compatible-translation-client와-prompt-contract-이식), [M1-PERSIST-001](CURRENT.md#m1-persist-001--persistence와-data-contract-parity), [M1-PERSIST-002](CURRENT.md#m1-persist-002--rover-output-이식번역-jsoncsv-export-출력-경로-기본-입출력-디렉터리)(번역 JSON/CSV export 구현, D29)
- **Prerequisites:** Step 3 DONE(또는 기존 artifact의 `sourceText`로 단독 검증 가능).
- **Related analysis:**
  - [TR-LLM §2 Actual Production Call Path](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#2-actual-production-call-path), [§3 Exact Request Anatomy](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#3-exact-request-anatomy), [§16 Minimal Linux Rover Translation Contract](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#16-minimal-linux-rover-translation-contract), [§18 Milestone 1 Blockers](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#18-milestone-1-blockers-if-any)
  - [TR-LLM §8 Glossary](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#8-glossary-lifecycle), [§9 Character](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#9-character-memory-lifecycle), [§10 Story Memory Lifecycle](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#10-story-memory-lifecycle)
  - [TRANSLATION_PIPELINE §4 Input Contract](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#4-translation-input-contract), [§5 Output Contract](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#5-translation-output-contract), [§6 Retry / Failure / Recovery](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#6-retry--failure--recovery), [§7 Ordering and Block Identity](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#7-ordering-and-block-identity), [§15 Runtime Smoke Test Plan](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#15-runtime-smoke-test-plan-미실행)
- **Source areas to inspect:** `src/main/pageWorkflow/pageWorkflowTranslation.ts`, `src/main/wholePagePipeline.ts`(translate에 필요한 분기만), `src/main/pipeline/`(request options, retry, parse, keep-block mapping, `pageContextPersistence.ts`, `cumulativePageContext.ts`), `src/main/runtime/prompts/`, `src/main/runtime/parsing/`, `src/main/runtime/transport/translation-request.cjs`, `src/main/previousChapterContext.ts`, managed 경로의 [source trace](../../analysis/TRANSLATION_MANAGED_BACKEND_SOURCE_TRACE.md#source-evidence).
- **Open decisions to resolve:** D16, D29(Rover Output export 구현), D32(26B 세부 구성), D33(Linux binary·packaging·lifecycle). backend/model 계열은 확정이며 Linux 실행 설정·live 검증 조건은 이 Step에서 정한다([실행 환경](../../../AGENTS.md#실행-환경)). 기록: D14, D15(현재 동작 보존).
- **Architecture/coupling concerns:**
  - **순서 의존(M3에 중요):** page N+1 요청은 page N의 memory commit 이후 memory를 읽는다([TR-LLM §10.1](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#101-workflow의-저장-의미-fact)). 이 의존을 stage contract나 Result에 명시하고 [M3-TRANS-001](../M3_PIPELINING/IDEAS.md#m3-trans-001--translation-memory-순차-dependency-완화)과 연결한다.
  - translation은 page/block state와 work 단위 `style-guide.json`, chapter 단위 `story-memory.json`을 쓴다.
  - Carrot은 endpoint session을 page마다 열고 닫는다. managed `gemma`는 실제 start/stop 비용이 있으며 M1은 이 lifecycle을 우선 보존한다. 과거 `openai-api` 실사용에서는 비용이 없었다([TR-LLM §13.3](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#133-잠재-위험-fact-code--inference-영향)).
- **Validation:** 고정 OCR/page/context 입력으로 request construction(저장된 `result.json`의 prompt·system prompt와 비교), parsing, merge, memory 갱신을 검증한다. endpoint 실호출 smoke는 TRANSLATION_PIPELINE §15 S4를 따르되 아래 원칙대로 local backend를 쓸 수 있다. server 설정은 결과와 함께 기록한다.
- **M1 translation correctness (2026-10-03 사용자 결정):**
  - 기준은 번역 문장의 exact parity가 아니라 observable contract다: request payload, prompt/context 구성, block/text grouping과 순서, API 호출 흐름, timeout/retry/error 처리, response parsing, persistence, empty/partial/error response 처리, downstream workflow 연결.
  - deterministic하게 비교할 수 있는 request/response 구조와 parsing 결과는 Carrot reference behavior로 검증한다. 번역 문장 자체의 reference exact-match test는 만들지 않는다.
  - 외부 개인 번역 서버의 availability는 M1 진행의 전제가 아니다. live 호출 검증에는 Rover PC(RTX 5090) 등에서 쓸 수 있는 local OpenAI-compatible LLM backend를 쓸 수 있다. 다른 LLM/backend 때문에 생긴 번역 문구 차이는 implementation regression이 아니다.
  - managed llama-server 경로가 M1 대상이므로([2026-10-03 baseline 결정](CURRENT.md#m1-baseline-decision-2026-10-03)) Step 4 완료에는 managed Gemma 4 26B Linux backend의 start/readiness/request/stop·abort/restart와 page별 session 검증이 추가로 필요하다. request/parse 등 contract 검증은 기존 원칙대로 다른 local OpenAI-compatible backend로도 할 수 있으나, 그것으로 managed lifecycle 검증을 대체해 완료 처리하지 않는다.
- **Completion criteria:** D32·D33 해결과 managed Linux lifecycle smoke 완료. translated block과 memory 갱신이 Rover persistence boundary를 통해 저장되고 다음 page 요청에 반영됨. [DONE 조건](#step-status와-done-조건) 충족.
- **Result:**
  - Status: —
  - Progress notes: —
  - Commit: —
  - Validation result: —
  - Known differences: —
  - Remaining coupling / follow-up: —
  - Follow-up items: —

## Step 5 — Typography / Layout

- **Status:** NOT_STARTED
- **Goal:** 현재 typography와 bubble layout 동작을 Linux Core로 이식한다. 구현 순서상 Step 6(erase)보다 먼저 한다([바꾼 이유](#기본-8-step에서-바꾼-점)).
- **Scope:** raster 기반 글자 크기 추정과 source-match 입력(`fontSizePx`, `fontSizeIntent`, `sourceFontFacePx`, `sourceFontSizeConfidence`, `sourceFontSizeMethod`, `autoFitText`), typography merge, bubble layout(Koharu layout 재검출 + slot 계산, `bubbleLayout`, `renderBbox`), renderer에 전달할 layout state, 필요한 기존 formatting 기본값. 범위가 크면 5A Typography / 5B Layout으로 나눌 수 있다(M1 scope는 같다).
- **Explicit non-goals:** 자동 font matching의 새 구현(D17 결정 전), work typography profile, bubble sculpt 등 고급 layout correction([INITIAL §7](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#7-초기-rovercmt에서-제외-가능한-항목)), renderer backend 구현(Step 7).
- **Related M1 items:** [M1-CORE-001](CURRENT.md#m1-core-001--linux-core-pipeline-port)(typography/layout stage), [M1-RENDER-001](CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback)(renderer 입력 contract), [M1-DETECT-001](CURRENT.md#m1-detect-001--koharu-layout-onnx-linux-runtime)(Koharu 재사용)
- **Prerequisites:** Step 2 DONE(Koharu runtime), Step 4 DONE(layout eligibility가 `translatedText`를 요구).
- **Related analysis:**
  - Typography/Layout 전용 analysis는 없다(D18). Step 시작 시 source trace로 보완하고, 필요하면 새 analysis 문서로 남긴다.
  - [INITIAL §3.6 Typography / Layout](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#36-typography--layout--portable--adaptable), [CORE §1](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#1-end-to-end-production-data-flow)(typography·layout 출력 필드), [CORE §15](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#15-minimal-e2e-contract)
  - [DETECTION §8 Detector Mask Lifecycle](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#8-detector-mask-lifecycle--3회-호출-검증), [§9 Bubble / Layout Detection Relationship](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#9-bubble--layout-detection-relationship)
  - [RENDERER_LIBRARY_FEATURE_CENSUS §6.1](../../analysis/RENDERER_LIBRARY_FEATURE_CENSUS.md#61-source-match-크기-결정-입력이-snapshot에-없다) — source-match 입력이 없으면 renderer 크기가 달라진다.
- **Source areas to inspect:** `src/main/pageWorkflow/pageWorkflowTypography.ts`, `src/main/pageWorkflow/pageWorkflowTypographyMerge.ts`, `src/main/pageWorkflow/pageWorkflowImages.ts`(`layoutWorkflowPage`), `src/main/inpainting/bubbleLayoutRunner.ts`, `src/main/bubbleLayout/`, `src/shared/blockFormat.ts`.
- **Open decisions to resolve:** D17(사용자 확인), D18(trace).
- **Architecture/coupling concerns:** typography는 raster, `sourceText`, block geometry를 읽고 erase가 쓰는 `fontSizePx`를 쓴다. layout은 원본 raster와 `translatedText`를 읽고 `bubbleLayout`·`renderBbox`를 쓴다. `bubbleLayout`은 `chapter.json`의 큰 비중을 차지한다([INPAINTING §7](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#7-long-run--page-count-scaling-investigation)). bubble layout 코드는 Step 6 erase prepass가 재사용한다.
- **Validation:** 고정 translated block 입력으로 font size·source-match 필드·bubble layout·`renderBbox`를 기존 Carrot 결과와 비교한다.
- **Completion criteria:** renderer가 쓸 typography/layout state가 Rover stage boundary로 저장되고, Step 6이 쓸 `fontSizePx`와 bubble layout 코드가 준비됨. [DONE 조건](#step-status와-done-조건) 충족.
- **Result:**
  - Status: —
  - Progress notes: —
  - Commit: —
  - Validation result: —
  - Known differences: —
  - Remaining coupling / follow-up: —
  - Follow-up items: —

## Step 6 — Inpainting / Erase

- **Status:** NOT_STARTED
- **Goal:** 기존 erase/inpainting 동작을 Linux RoverCMT로 이식한다.
- **Scope:** mask 생성, crop 계획, bubble prepass 의존, 상주 FLUX runner(Rust/Candle, Linux CUDA), 결과 artifact와 block binding(`erasedWorkflowRegions`), 현재 erase semantics.
- **Explicit non-goals:** Fast Erase, solid balloon fill, crop 수 감소 등 [M4 Inpainting IDEAS](../M4_OPTIMIZATION/IDEAS.md#inpainting). Koharu LaMa/AOT, Codex erase, Python Diffusers, ZLUDA/HIP([INPAINTING §17 DROP INITIALLY](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#17-recommended-migration-boundary)). Translation ↔ Erase 병렬 통합(Post-M1).
- **Related M1 items:** [M1-INPAINT-001](CURRENT.md#m1-inpaint-001--flux-klein-candle-runner-linux-runtime), [M1-RUNTIME-001](CURRENT.md#m1-runtime-001--linux-runtimemodel-의존성-교체적응)
- **Prerequisites:** Step 5 DONE(`fontSizePx`, bubble layout 코드). Linux CUDA GPU 환경.
- **Related analysis:**
  - [INPAINTING §4 Input Contract](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#4-input-contract), [§5 Mask Generation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#5-mask-generation), [§6 Runtime Lifecycle](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#6-inpainting-runtime-lifecycle), [§9 Output Contract](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#9-output-contract), [§12 Linux RoverCMT Boundary](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#12-linux-rovercmt-boundary), [§17 Recommended Migration Boundary](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#17-recommended-migration-boundary), [§18 Exact Next Step](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#18-exact-next-step)
- **Source areas to inspect:** `src/main/pageWorkflow/pageWorkflowImages.ts`(`eraseWorkflowPage`), `src/main/pageWorkflow/sourceEraseScale.ts`, `src/main/inpainting/`(mask geometry, pattern mask, Flux engine pool, worker client), `tools/mgt-flux-klein-runner/`.
- **Open decisions to resolve:** D19. 기록: D20(현재 동작 보존), D21(기존 handoff 순서 보존), D9의 Rust/CUDA runner 배포 형태.
- **Architecture/coupling concerns:**
  - erase는 원본 또는 기존 inpainted raster, block bbox, `fontSizePx`, bubble prepass(Koharu)를 읽고 inpainted/mask artifact와 `erasedWorkflowRegions`를 쓴다.
  - erase 대상 선정은 `translatedText`를 보지 않는다([CORE §11](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#11-failure-semantics)).
  - FLUX와 Koharu, Hayai가 GPU를 공유한다. 기존 해제 순서를 이식하고 공유 resource를 Result에 기록한다([CORE §8](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#8-runtime--gpu-ownership-map)).
  - Step 8은 기존 순차 stage 의미와 runtime 해제 순서를 검증한다. stage boundary는 execution policy와 분리한다([A6](#a6-stage-implementation과-execution-policy를-분리하는-방향)).
- **Validation:** 고정 page/block/mask 입력으로 기존 `inpaintMaskPath`·`inpaintedImagePath`와 비교한다(INPAINTING §18 protocol smoke부터). model load 시간과 crop 시간은 기록만 한다.
- **Completion criteria:** erase 결과가 Rover stage boundary로 저장되고 layout·renderer가 쓸 수 있음. [DONE 조건](#step-status와-done-조건) 충족.
- **Result:**
  - Status: —
  - Progress notes: —
  - Commit: —
  - Validation result: —
  - Known differences: —
  - Remaining coupling / follow-up: —
  - Follow-up items: —

## Step 7 — Renderer (Skia primary)

- **Status:** NOT_STARTED
- **Goal:** M1 renderer를 Linux에서 구현한다. 확정 전략은 [M1-RENDER-001](CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback)을 따른다: Skia Canvas primary, Playwright Chromium fallback/reference.
- **Scope:** Skia Canvas renderer backend, page composition(inpainted raster + typography/layout state), pinned font 배포, output 형식(D23), v3 contract-aligned fixture 재사용, Skia capability smoke(Korean/Japanese CJK font loading, Latin/digit 혼용, font fallback, CJK shaping, vertical text, 일반적인 font switching).
- **Explicit non-goals:** 대규모 font benchmark. Playwright 제거 또는 REJECTED 처리. renderer 성능 최적화([M4-RENDER-001](../M4_OPTIMIZATION/IDEAS.md#m4-render-001--선택된-linux-renderer-backend의-성능-최적화)). M2 Golden Sample 구성. 현재 library에서 쓰이지 않는 advanced field의 삭제(schema는 optional로 유지, [CORE §16](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기)).
- **Related M1 items:** [M1-RENDER-001](CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback), [M1-COMPAT-001](CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability)
- **Prerequisites:** Step 5 DONE(layout state). Step 6 DONE(inpainted raster). fixture 기반 renderer 작업은 v3 fixture로 먼저 시작할 수 있다.
- **Related analysis:** [M1-RENDER-001의 Related analysis](CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback)를 따른다. 핵심: [RECOMPARISON §6 Canonical v3 contract](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#6-canonical-v3-contract), [§11](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#11-fixture-results), [§17](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#17-unresolved-questions), [RENDERER_CANDIDATE §3](../../analysis/RENDERER_CANDIDATE_ANALYSIS.md#3-actual-renderer-requirements), [§4 Reusable Layout vs Backend Responsibilities](../../analysis/RENDERER_CANDIDATE_ANALYSIS.md#4-reusable-layout-vs-backend-responsibilities).
- **Source areas to inspect:** `RoverCarrot/spikes/renderer-comparison/`(v3 manifest, `production-page.cjs`, `shared-layout.ts`, `native-adapters.cjs`, `playwright-adapter.cjs`), `src/renderer/src/lib/overlayLayout.ts`, `src/renderer/src/lib/sourceFontSizeMatching.ts`, `src/renderer/src/lib/bubbleFontSizeFitting.ts`, `src/main/pageExport.ts`, `src/main/pageExportHtml.ts`. spike 코드는 production으로 정리해 옮기며, spike 디렉터리 자체를 runtime dependency로 쓰지 않는다.
- **Open decisions to resolve:** D22, D23. D28은 이 Step의 blocker가 아니다.
- **Architecture/coupling concerns:** renderer는 모든 이전 stage 결과(번역, geometry, typography, bubble layout, inpainted raster)를 읽는다. Skia와 Playwright가 같은 renderer boundary 뒤에 있어야 fallback이 가능하다([A2](#a2-상위-core는-하위-implementation을-가능한-한-몰라야-한다)).
- **Validation:** v3 fixture를 Linux Skia로 렌더하고 reference와 비교(자동 diagnostic은 보조), Linux Skia smoke, font capability smoke, memory/runtime sanity check. Skia fallback 조건([M1-RENDER-001](CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback))에 해당하는 blocker가 있으면 조용히 바꾸지 않고 근거와 History를 M1-RENDER-001에 기록한 뒤 Playwright를 쓴다.
- **Completion criteria:** Linux에서 Rover pipeline 결과로 최종 page 이미지를 생성할 수 있고 capability smoke 결과가 기록됨. [DONE 조건](#step-status와-done-조건) 충족.
- **Result:**
  - Status: —
  - Progress notes: —
  - Commit: —
  - Validation result: —
  - Known differences: —
  - Remaining coupling / follow-up: —
  - Follow-up items: —

## Step 8 — Full Integration & Interoperability

- **Status:** NOT_STARTED
- **Goal:** 모든 M1 component를 실제 Linux pipeline으로 연결하고 M1 사용자 요구사항을 E2E로 검증한다.
- **Scope:** full real pipeline 연결, stage 순서, persistence/output 통합, error 전파, progress/timing, 기존 순차 실행과 managed translation lifecycle 검증, 실제 output 생성, Windows Carrot interoperability.
- **Explicit non-goals:** 기존 Translation ↔ Erase 병렬 경로 이식·검증(Post-M1), GPU scheduling·vLLM·5090 최적화. M3 수준의 새 pipelining(page N/N+1 overlap, 추가 stage overlap, page/stage concurrency). M2 Golden Sample/benchmark 구성. 성능 최적화.
- **Related M1 items:** 모든 M1 CURRENT item. 특히 [M1-CORE-001](CURRENT.md#m1-core-001--linux-core-pipeline-port), [M1-TRANS-001](CURRENT.md#m1-trans-001--openai-compatible-translation-client와-prompt-contract-이식), [M1-COMPAT-001](CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability), [M1-PERSIST-002](CURRENT.md#m1-persist-002--rover-output-이식번역-jsoncsv-export-출력-경로-기본-입출력-디렉터리)(Rover Output 통합, D29)
- **Prerequisites:** Step 1–7 DONE. Windows Carrot 설치본(interoperability 검증용).
- **Related analysis:** [INPAINTING §8 Experimental Translation / Erase Parallel Path](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#8-experimental-translation--erase-parallel-path)(Post-M1 참고: 병렬 경로는 M1 검증 대상이 아님), [CORE §11 Failure Semantics](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#11-failure-semantics), [CORE §15 Minimal E2E Contract](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#15-minimal-e2e-contract), Step 1의 Carrot loader analysis(D1 결과).
- **Source areas to inspect:** `src/main/application/pageWorkflowService.ts`(순차 경로), `src/main/pageWorkflow/pageWorkflowRuntime.ts`(pending memory commit, `shouldResetPending`).
- **Open decisions to resolve:** D11, D25, D26, D29(Rover Output 통합). 확인: D32·D33(Step 4 해결 근거). D24·D30은 Post-M1로 이동. 확인: D5 확장, D9 최종 배포 형태, D10 import parity, D20, D27.
- **Architecture/coupling concerns:** 순차 stage 순서, page별 managed translation start/stop, 기존 GPU handoff와 memory commit 순서를 검증하고 Result에 기록한다. execution policy는 stage implementation이 아니라 orchestration 쪽에 둔다([A6](#a6-stage-implementation과-execution-policy를-분리하는-방향)). 남은 coupling은 [M3 IDEAS](../M3_PIPELINING/IDEAS.md)와 연결한다.
- **Validation:**
  - 실제 chapter/page로 Linux E2E smoke(순차 baseline; 병렬 검증은 Post-M1)
  - RoverCMT가 만든 output/project를 실제 Windows Carrot에서 열어 load/open, 기본 데이터 사용, 사용자가 쓰는 기본 edit/export workflow가 깨지지 않는지 확인. byte/pixel identical은 요구하지 않는다
- **Completion criteria:** M1 CURRENT item 각각의 `Progress`와 완료 근거가 CURRENT.md에 기록되어 M1 completion을 판단할 수 있음. [M1-INPUT-001](CURRENT.md#m1-input-001--carrot-inputimport-parity) parity 점검표의 모든 항목이 구현·검증되었거나 사용자 결정으로 처리됨(Carrot input 기능 누락 없음). [DONE 조건](#step-status와-done-조건) 충족. M1 완료 선언과 다음 active milestone 결정은 사용자가 한다.
- **Result:**
  - Status: —
  - Progress notes: —
  - Commit: —
  - Validation result: —
  - Known differences: —
  - Remaining coupling / follow-up: —
  - Follow-up items: —
