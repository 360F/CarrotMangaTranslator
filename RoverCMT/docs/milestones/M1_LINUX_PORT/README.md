# M1 — Linux Port

**Status: ACTIVE** · [Planning index](../README.md) · [CURRENT](CURRENT.md) · [IDEAS](IDEAS.md) · [REJECTED](REJECTED.md)

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

- M1은 **성능 최적화를 목표로 하지 않는다.** 먼저 기존 기능을 Linux에서 끝까지 재현한다.
- 속도 개선 아이디어는 발견해도 M3(병렬화) 또는 M4(stage 최적화)의 IDEAS에 기록하고 M1에서 구현하지 않는다.
- 동작을 바꿔야 하는 열린 결정(analysis의 "Open Decisions")은 사용자에게 묻는다. 묻기 전 기본값은 "Carrot 현재 동작 보존"을 제안할 수 있지만 확정하지 않는다.
- 이식 방식은 [MIGRATION_PRINCIPLES.md](../../MIGRATION_PRINCIPLES.md)를 따른다(parent source 직접 import 금지, 단계적 이식, 이해하지 못한 코드 임의 제거 금지).

## 알려진 문서 간 긴장 (사용자 확인 필요)

- [PROJECT_VISION.md](../../PROJECT_VISION.md) §5와 [AGENTS.md](../../../AGENTS.md)는 "Carrot과의 동작·기능·내부 구조 호환성은 목표가 아니다", "compatibility 포기"를 허용한다.
- 반면 M1 요구사항은 "기존 Windows/Electron 결과와 같은 프로젝트에서 공유/호환 가능한 수준"을 요구한다.
- 이 차이는 [M1-COMPAT-001](CURRENT.md#m1-compat-001--windowselectron-결과프로젝트-호환)에서 **호환 수준**을 정할 때 해결한다. 그 전까지 milestone 요구사항(더 최근의 사용자 결정)을 M1 범위로 취급하되, vision 문서는 수정하지 않았다.

## 범위 밖 (M1에서 하지 않음 — REJECTED가 아님)

- pipeline 병렬화 → [M3](../M3_PIPELINING/README.md)
- stage별 속도 최적화 → [M4](../M4_OPTIMIZATION/README.md)
- multi-file queue 등 새 기능 → [M5](../M5_FEATURES/README.md)
- Carrot의 editor, manual review, PSD export, Codex 연동 등 초기 Core에서 제외 가능한 항목은 [INITIAL_MIGRATION_ANALYSIS §7](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#7-초기-rovercmt에서-제외-가능한-항목)과 [CORE §16](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기)에 근거가 있다. 이를 제외할지는 M1-COMPAT-001의 호환 수준 결정과 함께 확인한다.

## 주요 근거 문서

| 문서 | M1에서의 용도 |
|---|---|
| [INITIAL_MIGRATION_ANALYSIS.md](../../analysis/INITIAL_MIGRATION_ANALYSIS.md) | Linux Core 가능성 결론(§1), component 분류(§3–§4), upstream Linux 지원(§5), risk(§8) |
| [CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md) | stage contract(§6, §15), persistence(§9, §14), open decisions(§17) |
| 각 stage 분석 | Detection / OCR / Translation / Translation LLM / Inpainting / Renderer(아래 CURRENT item에서 section 단위로 링크) |
