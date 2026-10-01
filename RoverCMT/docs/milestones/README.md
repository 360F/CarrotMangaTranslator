# RoverCMT Milestones — Planning Index

이 문서는 RoverCMT **계획과 진행 추적의 진입점이자 source of truth**다.
이전 대화 기억이 없는 사람이나 AI 에이전트도 이 파일 하나로 프로젝트의 현재 위치를 파악하고,
필요한 근거 문서로 내려갈 수 있도록 작성한다.

> **기억에 의존하지 않는다.** ChatGPT, Claude, Codex 등 어떤 에이전트도 이전 대화의 memory가 있다고 가정하지 않는다.
> 작업 시작 시 repository의 현재 문서를 source of truth로 사용한다.
> 기억과 문서가 충돌하면 repository의 최신 상태(`git fetch` 후)를 먼저 확인하고, 그래도 불명확하면 사용자에게 묻는다.

## 1. RoverCMT는 무엇인가

RoverCMT는 CarrotMangaTranslator(Windows/Electron 데스크톱 앱)의 자동 만화 번역 pipeline을
GUI 없이 Linux에서 독립 실행되는 Core로 옮기고, 이후 처리 시간을 줄이고 기능을 넓히는 프로젝트다.

- 목표와 철학: [PROJECT_VISION.md](../PROJECT_VISION.md)
- 이식 원칙: [MIGRATION_PRINCIPLES.md](../MIGRATION_PRINCIPLES.md)
- 에이전트 작업 규칙: [../../AGENTS.md](../../AGENTS.md)

## 2. 현재 상태 요약

| 항목 | 값 |
|---|---|
| **Active milestone** | **M1 — Linux Port** |
| M1 현재 작업 목록 | [M1_LINUX_PORT/CURRENT.md](M1_LINUX_PORT/CURRENT.md) (item과 Progress의 source of truth) |
| M1 구현 순서 / 다음 Step | [M1_LINUX_PORT/IMPLEMENTATION_PLAN.md](M1_LINUX_PORT/IMPLEMENTATION_PLAN.md) |
| M2–M5 | 정의와 future scope만 있다. 아직 active가 아니다 |
| Reference source | fork `fd461737`(upstream v2.8.2 `d20695df` + fork 커밋). "기존 Carrot"의 의미와 fork 전용 기능: [RoverCMT/AGENTS.md](../../AGENTS.md#reference-implementation) |
| RoverCMT production code | 아직 없다. 지금까지는 분석(`docs/analysis/`)과 renderer spike(`spikes/renderer-comparison/`)만 있다 |
| 확정된 주요 결정 | 2026-10-01: M1 호환 = Windows Carrot에서 output open/use(interoperability), 기존 Translation ↔ Erase 병렬 경로는 M1에서 이식, M1 renderer = Skia Canvas primary / Playwright Chromium fallback. 상세: [M1 CURRENT](M1_LINUX_PORT/CURRENT.md) 상단 표 |
| 마지막 구조 갱신 | 2026-10-01 reference baseline·실행 환경·로컬 데이터·Git/CI 정책을 [RoverCMT/AGENTS.md](../../AGENTS.md)에 기록, Rover Output 이식 item(M1-PERSIST-002) 추가 |

## 3. Milestones

| ID | 이름 | 목표(한 줄) | 상태 | 문서 |
|---|---|---|---|---|
| M1 | Linux Port | Windows/Electron Carrot의 자동 번역 pipeline을 Linux CLI RoverCMT로 그대로 이식한다. 성능 최적화는 목표가 아니다 | **ACTIVE** | [README](M1_LINUX_PORT/README.md) · [CURRENT](M1_LINUX_PORT/CURRENT.md) · [IDEAS](M1_LINUX_PORT/IDEAS.md) · [REJECTED](M1_LINUX_PORT/REJECTED.md) |
| M2 | Reviewed Test Set / Benchmark | 사용자가 검토·승인한 Golden Sample과 stage별/E2E benchmark를 만든다 | not active | [README](M2_TEST_SET/README.md) · [CURRENT](M2_TEST_SET/CURRENT.md) · [IDEAS](M2_TEST_SET/IDEAS.md) · [REJECTED](M2_TEST_SET/REJECTED.md) |
| M3 | Pipelining | M1과 기능/품질 차이 없이 stage/page 병렬화로 전체 시간을 줄인다. 불가능하면 근거를 남기고 종료할 수 있다 | not active | [README](M3_PIPELINING/README.md) · [CURRENT](M3_PIPELINING/CURRENT.md) · [IDEAS](M3_PIPELINING/IDEAS.md) · [REJECTED](M3_PIPELINING/REJECTED.md) |
| M4 | Optimization | stage 자체의 처리속도를 항목별로 실험·개선한다. 품질 trade-off는 사용자가 결정한다 | not active | [README](M4_OPTIMIZATION/README.md) · [CURRENT](M4_OPTIMIZATION/CURRENT.md) · [IDEAS](M4_OPTIMIZATION/IDEAS.md) · [REJECTED](M4_OPTIMIZATION/REJECTED.md) |
| M5 | New Features | Carrot 이식·성능과 별개인 RoverCMT 고유 기능(queue, unattended batch 등) | not active | [README](M5_FEATURES/README.md) · [CURRENT](M5_FEATURES/CURRENT.md) · [IDEAS](M5_FEATURES/IDEAS.md) · [REJECTED](M5_FEATURES/REJECTED.md) |

순서 의존: M2 benchmark는 M3/M4의 Before/After 측정 기준이다. M3/M4는 M1 결과를 baseline으로 비교한다.

## 4. 상태 정의

| 상태 | 의미 | 위치 |
|---|---|---|
| **CURRENT** | 사용자가 하기로 결정한 작업. 그 milestone의 실제 scope | `CURRENT.md` |
| **IDEAS** | 가치가 있어 기록했지만 아직 구현 결정을 하지 않은 후보. 아이디어가 있다는 이유만으로 CURRENT로 승격하지 않는다 | `IDEAS.md` |
| **REJECTED** | 검토했지만 하지 않기로 결정한 것. **이유가 필수**다 | `REJECTED.md` |

- "Active milestone"은 지금 실제로 작업 중인 milestone이다. 비-active milestone에도 CURRENT(결정된 scope)가 있을 수 있다.
- CURRENT 안의 진행 정도는 item의 `Progress` 필드(`not started` / `in progress` / `done` / `blocked`)로 표시한다.
- 상태 변경(승격, 폐기)은 **사용자 결정**으로만 한다. 에이전트는 제안할 수 있지만 스스로 상태를 바꾸지 않는다.

## 5. Evidence(analysis) vs Planning(milestones)

| 폴더 | 역할 | Source of truth인 것 |
|---|---|---|
| [`docs/analysis/`](../analysis/) | **Evidence / Research.** 코드 추적, artifact 측정, spike 결과. 사실(FACT)과 추론(INFERENCE)을 구분해 기록한다 | 기술 조사 결과 |
| `docs/milestones/` | **Planning / Tracking.** 무엇을 할지, 진행 중인 것, 대기 아이디어, 폐기와 그 이유 | 계획·상태·결정 |
| [`PROJECT_VISION.md`](../PROJECT_VISION.md), [`MIGRATION_PRINCIPLES.md`](../MIGRATION_PRINCIPLES.md) | 목표와 원칙 | 방향과 원칙 |
| [`CURRENT_STATUS.md`](../CURRENT_STATUS.md), [`ANALYSIS_PLAN.md`](../ANALYSIS_PLAN.md) | milestone 도입 이전(Phase 0) 분석 단계의 상태·계획 기록 | 역사 기록. 앞으로의 계획은 여기서 관리하지 않는다 |

규칙:

- analysis 문서는 이동하거나 rename하지 않는다. 분석 결론을 milestone 문서에서 다시 쓰지 않고 **링크**한다.
- 수치는 analysis 원문을 그대로 인용한다. 반올림·변형하지 않는다.
- analysis 문서 상단의 `Project Tracking` 블록에는 관련 milestone 링크만 둔다. **CURRENT/IDEAS/REJECTED 상태는 analysis에 복제하지 않는다.**

## 6. 작업 전에 무엇을 읽는가 (Progressive disclosure)

```text
RoverCMT/AGENTS.md
  → docs/milestones/README.md   (이 문서: 전체 위치, 규칙)
    → 해당 milestone README     (목표, 범위, 원칙)
      → (M1 구현 작업) IMPLEMENTATION_PLAN.md → 현재 Step
        → CURRENT / IDEAS / REJECTED (item 단위; Step이 가리키는 item)
          → item·Step의 Related analysis (필요한 section만)
            → Step의 Source areas (실제 source code)
```

| 하려는 일 | 먼저 읽을 것 |
|---|---|
| 다음 할 일 판단 | 이 문서 §2 → active milestone README → `IMPLEMENTATION_PLAN.md`의 현재 위치·Progress(M1) |
| "M1 Step N 진행해" / "다음 Step 진행해" | [M1 IMPLEMENTATION_PLAN의 How to use this plan](M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#how-to-use-this-plan-agent) |
| 특정 item 작업 시작 | item의 Related analysis와 Dependencies, 해당 milestone README의 원칙 |
| 아이디어 추가·보완 | 이 문서 §7 |
| 상태 변경·폐기 | 이 문서 §8 |
| 기술 근거 찾기 | 이 문서 §9 |

## 7. Adding / Updating Project Items

사용자가 "○○ 아이디어 추가해줘"처럼 짧게 말해도 다음 절차를 따른다.

1. **이해**: 아이디어가 바꾸려는 것(stage, 비용, 품질, 기능)을 한 문장으로 정리한다.
2. **Milestone 결정**: 아래 기준으로 primary owner 하나를 고른다.
   | 아이디어 성격 | Milestone |
   |---|---|
   | 기존 Carrot 기능을 Linux에서 재현하는 데 필요 | M1 |
   | 테스트셋, benchmark, 비교·측정 방법 | M2 |
   | 여러 stage/page를 동시에 실행해 전체 시간을 줄임 | M3 |
   | 한 stage/runtime 자체를 더 빠르게(또는 같은 결과를 더 싸게) 만듦 | M4 |
   | Carrot에 없던 새 사용자 기능 | M5 |
   애매하면 primary owner 하나에 넣고 다른 milestone은 `Related items`로만 연결한다. **같은 아이디어를 여러 milestone에 복제하지 않는다.**
3. **중복 검색**: 기존 item과 겹치는지 먼저 찾는다.
   ```bash
   grep -rn -i "<키워드>" RoverCMT/docs/milestones/
   ```
   한국어와 영어 동의어를 함께 검색한다(예: `단색|solid|fill|Fast Erase`). 이미 있으면 **새 item을 만들지 않고** 기존 item의 Summary·Related analysis·Decision needed를 보완한다.
4. **근거 검색**: `grep -rn -i "<키워드>" RoverCMT/docs/analysis/`로 관련 분석을 찾는다.
   - 있으면 정확한 상대 링크와 section, 그리고 "왜 이 분석이 근거인지" 한 줄을 적는다.
   - 없으면 `Evidence: not yet analyzed`라고 적는다. 근거를 지어내지 않는다.
5. **추가**: 해당 milestone의 `IDEAS.md`에 아래 template으로 추가한다. 사용자가 명시적으로 "하기로 했다"고 말한 경우에만 `CURRENT.md`에 넣는다.
6. **ID 부여**: §7.2 규칙.
7. **보고**: 어느 milestone/ID에 넣었는지, 중복 여부, 근거 유무를 사용자에게 알린다.

### 7.1 Item template

```markdown
### M<n>-<AREA>-<NNN> — Short title

- **Status:** IDEA            <!-- CURRENT | IDEA | REJECTED -->
- **Progress:** —             <!-- CURRENT만: not started | in progress | done | blocked -->
- **Summary:** 무엇을 하는가(1–3줄).
- **Why it matters:** 어떤 비용/위험/요구를 해결하는가. 가능하면 analysis 수치를 인용.
- **Related analysis:**
  - [FILE.md §N Title](../../analysis/FILE.md#anchor) — 이 section이 왜 근거인지 한 줄.
  - 또는 `Evidence: not yet analyzed`
- **Related items:** 다른 milestone의 관련 ID(있으면).
- **Dependencies:** 먼저 필요한 item, 결정, 측정.
- **Decision / validation needed:** 사용자 결정 사항, 필요한 측정·실험.
- **History:** YYYY-MM-DD 생성/변경 사유(짧게).
```

### 7.2 ID 규칙

- 형식: `M<milestone>-<AREA>-<NNN>` (예: `M4-TRANS-001`, `M4-INPAINT-001`, `M3-RUNTIME-001`, `M5-QUEUE-001`).
- 번호는 milestone·AREA 안에서 증가한다. 다음 번호는 `grep -rhoE "M4-INPAINT-[0-9]{3}" RoverCMT/docs/milestones | sort | tail -1`로 확인한다.
- **한번 만든 ID는 바꾸지 않는다.** title이 바뀌어도, 상태가 바뀌어도 그대로 둔다. 다른 milestone으로 옮겨야 하면 원래 위치에 `Moved to <새 ID>`를 남긴다.
- 삭제하지 않는다. 하지 않기로 했으면 REJECTED로 옮긴다.

| AREA | 의미 |
|---|---|
| CORE | pipeline 전체 구조·orchestration |
| CONFIG | settings/config, 경로 |
| CLI | 명령행 실행 |
| OBS | 진행상황·시간 관측(observability) |
| COMPAT | Carrot과의 결과/프로젝트 호환 |
| PERSIST | 저장·데이터 contract |
| RUNTIME | model/runtime/GPU 수명, 의존성 |
| DETECT / OCR / TRANS / INPAINT / LAYOUT / RENDER | 해당 stage |
| GOLDEN / BENCH / JUDGE / VISUAL | M2 테스트셋·측정·평가 |
| SCHED / STATE | M3 scheduling, 공유 상태 |
| QUEUE / BATCH | M5 기능 |

새 AREA가 필요하면 이 표에 한 줄 추가한다.

## 8. 상태 변경 규칙

| 변경 | 조건 | 방법 |
|---|---|---|
| IDEA → CURRENT | 사용자가 하기로 결정 | item을 `CURRENT.md`로 옮기고 `Status`, `Progress`, `History`(날짜, "user decision") 갱신. ID 유지 |
| IDEA/CURRENT → REJECTED | 사용자가 하지 않기로 결정 | item을 `REJECTED.md`로 옮기고 아래 필수 항목 작성 |
| REJECTED → IDEA | 새 근거로 재검토 | 옮기고 History에 재검토 이유 기록 |
| Milestone active 변경 | 사용자 결정 | 이 문서 §2와 §3 표 갱신 |
| CURRENT 진행 | 작업 진행 | `Progress` 갱신. 완료 근거(commit, analysis, benchmark) 링크 |

**REJECTED 필수 항목** — 하나라도 없으면 REJECTED로 기록하지 않는다.

- What was reviewed: 무엇을 검토했는가
- Why rejected: 왜 하지 않기로 했는가
- Evidence: 판단 근거와 관련 analysis/benchmark 링크
- Decided by / date: 누가, 언제(가능하면)
- Revisit if: 다시 볼 조건(선택)

"현재 사용하지 않는다", "M1에서 하지 않는다"는 REJECTED 사유가 아니다. 그런 항목은 IDEAS에 두거나 해당 milestone의 범위 밖(Out of scope)으로 README에 적는다.

## 9. 관련 analysis 찾기

1. item의 `Related analysis` 링크를 따른다(가장 빠름).
2. 주제별 진입점:

| 주제 | 분석 문서 |
|---|---|
| 전체 이식성, component 분류, upstream Linux 지원 | [INITIAL_MIGRATION_ANALYSIS.md](../analysis/INITIAL_MIGRATION_ANALYSIS.md) |
| End-to-end data flow, stage contract, persistence, GPU ownership, open decisions | [CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md](../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md) |
| Detection(Koharu ONNX, region 후처리, 반복 추론) | [DETECTION_PIPELINE_MIGRATION_ANALYSIS.md](../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md) |
| OCR(HayaiOCR runtime, Linux smoke 계획) | [OCR_RUNTIME_MIGRATION_ANALYSIS.md](../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md) |
| Translation pipeline(backend, prompt, parser, mapping) | [TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md](../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md) |
| Translation LLM 요청 내용, context/memory, token·timing 근거 | [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md](../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md) |
| Erase/Inpainting(FLUX Klein, mask, 장시간 실행) | [INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md](../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md) |
| Renderer 후보와 기각 후보 | [RENDERER_CANDIDATE_ANALYSIS.md](../analysis/RENDERER_CANDIDATE_ANALYSIS.md) |
| Renderer fixture/font/reference | [RENDERER_FIXTURE_CENSUS.md](../analysis/RENDERER_FIXTURE_CENSUS.md), [RENDERER_LIBRARY_FEATURE_CENSUS.md](../analysis/RENDERER_LIBRARY_FEATURE_CENSUS.md), [RENDERER_FONT_RESOLUTION.md](../analysis/RENDERER_FONT_RESOLUTION.md), [RENDERER_PORTABLE_FONT_REFERENCE.md](../analysis/RENDERER_PORTABLE_FONT_REFERENCE.md) |
| Renderer 비교 결과(v2, 최신 v3) | [RENDERER_COMPARISON_SPIKE.md](../analysis/RENDERER_COMPARISON_SPIKE.md), **최신:** [RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md](../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md) |

3. 그래도 없으면 `grep -rn -i "<키워드>" RoverCMT/docs/analysis/`로 검색한다.
4. 분석 문서끼리 결론이 다르면 더 최신 문서의 "정정/Corrections" section을 확인한다(예: TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §21, CORE §0.1, DETECTION §0.1).

## 10. 문서 유지 규칙

- 계획·상태·아이디어·폐기는 **이 폴더에서만** 관리한다. 다른 문서에는 링크만 둔다.
- 새 analysis 문서를 만들면 상단에 `Project Tracking` 블록(관련 milestone 링크만)을 추가하고, 관련 item의 Related analysis에 링크한다.
- item을 고칠 때는 History에 한 줄 남긴다. 큰 재작성은 사용자 요청이 있을 때만 한다.
