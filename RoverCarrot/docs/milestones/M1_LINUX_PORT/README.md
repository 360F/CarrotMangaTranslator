# M1 — Linux Port

**Status: ACTIVE** · [Planning index](../README.md) · [CURRENT](CURRENT.md) · [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) · [IDEAS](IDEAS.md) · [REJECTED](REJECTED.md)

> **구현 작업을 시작하거나 "다음 Step"을 찾을 때는 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)를 읽는다.** Step 순서, architecture direction, Step별 열린 결정과 완료 기준, 현재 handoff(Step·State·Next role)와 implementation/review workflow가 있다. M1 item과 `Progress`의 source of truth는 [CURRENT.md](CURRENT.md)다.

## 목표

현재 Windows/Electron CarrotMangaTranslator의 **자동 번역 pipeline 기능**을 Linux RoverCMT로 그대로 이식한다.

## 요구사항 (사용자 정의, 2026-10-01)

- 기존 핵심 pipeline 기능 이식(Detection → OCR → Translation → Erase → Typography/Layout → Render → Output)
- settings/config 파일로 설정을 받는다
- input 파일/디렉터리 경로를 config화한다
- output 파일/디렉터리 경로를 config화한다
- GUI가 아닌 Linux 환경에서 bash/CLI command로 실행할 수 있다
- 실행 중 각 pipeline/stage의 진행상황과 소요시간을 실시간으로 확인할 수 있다
- 최종 산출물이 기존 Windows/Electron 환경의 결과와 같은 프로젝트에서 공유/호환 가능한 수준이어야 한다

## 원칙

- M1은 **성능 최적화를 목표로 하지 않는다.** 먼저 기존 기능을 Linux에서 끝까지 재현한다. managed Gemma 4 26B translation과 순차 실행 baseline은 [2026-10-03 결정](CURRENT.md#m1-baseline-decision-2026-10-03)을 따른다.
- 속도 개선 아이디어는 발견해도 M3(병렬화) 또는 M4(stage 최적화)의 IDEAS에 기록하고 M1에서 구현하지 않는다.
- 동작을 바꿔야 하는 열린 결정(analysis의 "Open Decisions")은 사용자에게 묻는다. 묻기 전 기본값은 "Carrot 현재 동작 보존"을 제안할 수 있지만 확정하지 않는다.
- 각 Step의 correctness oracle은 milestone 요구사항, 수정하지 않은 Carrot reference, 승인된 known difference다([Reference-driven validation](IMPLEMENTATION_PLAN.md#reference-driven-validation)).
- 이식 방식은 [MIGRATION_PRINCIPLES.md](../../MIGRATION_PRINCIPLES.md)를 따른다(parent source 직접 import 금지, 단계적 이식, 이해하지 못한 코드 임의 제거 금지).

## Compatibility의 의미 (2026-10-01 확정)

M1이 요구하는 "Windows Carrot과의 호환"은 **output interoperability**다.

> RoverCMT가 생성한 프로젝트/결과물을 기존 Windows Carrot에서 열었을 때 정상적으로 불러오고 사용할 수 있으면 된다.

요구하지 않는 것: 같은 내부 구현, 같은 runtime, 같은 renderer, byte-identical project representation, Electron과 pixel-identical 최종 raster.

기존 원칙과의 관계:

| 문서 | 원칙 | M1 compatibility와의 관계 |
|---|---|---|
| [PROJECT_VISION §2](../../PROJECT_VISION.md#2-carrotmangatranslator와의-관계), [§5](../../PROJECT_VISION.md#5-의도적인-trade-off) | Carrot의 모든 기능·내부 구조·workflow 유지는 목표가 아니다. 기존 workflow와 다른 결과, compatibility 포기를 받아들일 수 있다 | 충돌하지 않는다. M1은 구현·동작의 동일성이 아니라 **Carrot이 결과를 열 수 있는지**만 요구한다 |
| [MIGRATION_PRINCIPLES §5 Behavior Compatibility](../../MIGRATION_PRINCIPLES.md#5-behavior-compatibility) | state model, file layout, persistence 정책 등은 바뀔 수 있다 | Rover 내부 저장 방식은 달라도 된다. Carrot이 열 수 있는 형태로 내보내면 된다 |
| [AGENTS.md](../../../AGENTS.md) | 동작·기능·내부 구조 호환성은 목표가 아니다 | 같다. interoperability는 구현 호환이 아니라 데이터 교환 요구사항이다 |

구체적인 item과 검증은 [M1-COMPAT-001](CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability)에 있다.

## 2026-10-01 확정된 범위 결정

병렬 scope의 현재 적용은 [2026-10-03 대체 결정](CURRENT.md#m1-baseline-decision-2026-10-03)을 따른다.

- **Translation ↔ Erase 병렬 경로:** reference fork(`c5cef4cf`)의 기능이지만 **Deferred / Post-M1**이다([M1-CORE-002](CURRENT.md#m1-core-002--기존-translation--erase-병렬-실행-경로-이식)). 기존 M1 이식 결정은 [2026-10-03 baseline 결정](CURRENT.md#m1-baseline-decision-2026-10-03)으로 superseded; M3-SCHED-001로 연결한다.
- **Renderer:** Skia Canvas primary, Playwright Chromium fallback/reference([M1-RENDER-001](CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback)).

## 범위 밖 (M1에서 하지 않음 — REJECTED가 아님)

- 기존 Carrot에 없던 새 pipelining/concurrency(page N/N+1 overlap, 추가 stage overlap 등) → [M3](../M3_PIPELINING/README.md). 기존 Translation ↔ Erase 병렬 경로도 Post-M1이다.
- vLLM 사용 여부와 단일 RTX 5090용 runtime 최적화 → [M4-RUNTIME-002](../M4_OPTIMIZATION/IDEAS.md#m4-runtime-002--gpu-lifecycle-최적화); GPU scheduling → [M3-RUNTIME-001](../M3_PIPELINING/IDEAS.md#m3-runtime-001--pipelining을-위한-gpu-resource-scheduling). M1에서 새 runtime을 고르지 않는다.
- stage별 속도 최적화 → [M4](../M4_OPTIMIZATION/README.md)
- multi-file queue 등 새 기능 → [M5](../M5_FEATURES/README.md)
- Carrot의 editor, manual review, PSD export, Codex 연동 등 초기 Core에서 제외 가능한 항목은 [INITIAL_MIGRATION_ANALYSIS §7](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#7-초기-rovercmt에서-제외-가능한-항목)과 [CORE §16](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기)에 근거가 있다. 이를 제외할지는 사용자가 확인한다. M1-COMPAT-001 정의상 기준은 "RoverCMT 출력을 Windows Carrot에서 열어 사용할 수 있는가"다.

## 주요 근거 문서

| 문서 | M1에서의 용도 |
|---|---|
| [INITIAL_MIGRATION_ANALYSIS.md](../../analysis/INITIAL_MIGRATION_ANALYSIS.md) | Linux Core 가능성 결론(§1), component 분류(§3–§4), upstream Linux 지원(§5), risk(§8) |
| [CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md) | stage contract(§6, §15), persistence(§9, §14), open decisions(§17) |
| 각 stage 분석 | Detection / OCR / Translation / Translation LLM / Inpainting / Renderer(아래 CURRENT item에서 section 단위로 링크) |
