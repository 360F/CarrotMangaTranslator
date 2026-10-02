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

관련 분석 문서(`docs/analysis/`)는 milestone item의 Related analysis 링크를 따라 작업 범위에 맞게 읽는다.

Phase 0 역사 기록(필요할 때만 읽는다. 앞으로의 계획은 여기서 관리하지 않는다):

- `docs/CURRENT_STATUS.md` — milestone 도입 이전 분석 단계의 상태 기록
- `docs/ANALYSIS_PLAN.md` — 같은 시기의 분석 계획. milestone item이 특정 section을 링크할 때 그 section만 읽는다

---

## Reference implementation

RoverCMT 문서에서 "기존 Carrot", "Windows Carrot", "Carrot 현재 동작"은 upstream이 아니라 **이 저장소 루트의 fork 소스(`fd461737`)와 그것을 빌드한 Windows 앱**을 뜻한다. [M1-COMPAT-001](docs/milestones/M1_LINUX_PORT/CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability)의 interop 검증 대상도 이 fork 빌드다. upstream 저장소를 기준으로 동작을 판단하지 않는다.

- upstream: ucx0204/CarrotMangaTranslator v2.8.2 (`d20695df`)
- reference: upstream v2.8.2 + 사용자 fork 커밋 11개(`a4c7e2ab` ~ `fd461737`). 루트 `src/`는 `fd461737` 이후 바뀌지 않았고, 모든 analysis 문서의 `src/...` 경로와 줄 번호는 `fd461737` 기준이다.
- fork 전용 기능:

  | 기능 | 커밋 |
  |---|---|
  | Translation ↔ Erase 병렬 경로 | `c5cef4cf` |
  | Hayai OCR `ocrSubdivision`/`ocrHealth` 복구 | `cd7a336a` |
  | batched Hayai OCR 복원 | `e8efcecf` |
  | page workflow performance profiling | `a4c7e2ab` |
  | 기본 입출력 디렉터리 | `15eae20f` |
  | Rover Output: 번역 JSON/CSV export와 출력 경로 분리 | `314a5b91`, `a39aea0d`, `fd461737` |
  | matching model id 후보 위치 확인 | `62ef80b0` |

## 실행 환경

- 주 개발·검증 환경은 **Rover PC**다: Windows 11 + WSL2 Ubuntu 26.04.1 LTS, NVIDIA RTX 5090(약 32GB), WSL/Docker GPU 동작 확인, `nvidia-smi` CUDA 13.4 표시. M1 최종 목표 구성은 이 머신의 WSL2다. 이 환경 값은 사용자 보고 기준이며 에이전트가 직접 검증한 값이 아니다.
- Rover PC의 WSL2 Ubuntu 환경(GPU 접근 포함)이 실제로 준비됐는지는 M1 Step 1 시작 시 확인한다. 준비되지 않았으면 사용자에게 알리고 Step 1을 `BLOCKED`로 둔다. 확인 결과가 위 값과 달라도 사용자 확인 없이 문서의 환경 값을 바꾸지 않는다.
- 모든 에이전트가 이 머신에서 실행된다고 가정하지 않는다. GPU가 없는 세션도 있다.
- GPU가 필요한 검증(FLUX, Hayai CUDA 등)은 실행 시 GPU/runtime 가용성을 먼저 확인한다. 불가능하면 완료 처리하지 말고 Step Result에 "Rover PC에서 추가 검증 필요"로 남긴다.
- 번역 endpoint는 환경마다 다를 수 있다(외부 번역기, 내장/로컬 서버 등). 확정된 방향은 "OpenAI-compatible endpoint를 설정으로 받는다"까지다. URL, model, API key, 환경변수 이름, live 호출 허용 여부는 M1 Step 4에서 정한다. credential은 repo에 넣지 않는다.
- analysis의 run evidence는 예전 구성(로컬 RTX 5070 Ti에서 OCR/FLUX, Rover 5090에서 llama.cpp Gemma 번역 서버)에서 나왔다. 수치를 인용할 때 이 환경 차이를 감안한다.

## 로컬 전용 데이터

- **수동 검증 로컬 데이터:** `test-data/input/`에 실제 만화 폴더를 복사하고 결과는 `test-data/output/`에 둔다. `test-data/` 전체는 Git 제외이며 삭제·정리 대상이 아니다. 실제 사용자 config는 Git 제외 `config/config.toml` 하나이고(없으면 첫 실행이 내장 template으로 생성), 실행 로그는 Git 제외 `logs/`다. 둘 다 정리 대상이 아니다. 사용법은 [README](README.md)를 따른다. 자동 테스트용 작은 합성 이미지 fixture는 tracked `tests/fixtures/`에 둔다.
- **repo에 포함된 renderer 검증 데이터:** `spikes/renderer-comparison/`의 fixture(v1/v2/v3), Electron reference PNG, 고정 폰트뿐이다. spike `outputs/`(visual-comparison HTML 등)는 git 미추적 로컬 전용이다.
- **로컬 Carrot data root(gitignore, repo 밖):** M1 Step 2~6의 비교 기준(`hayai-regions.json`, `ocr-bbox-hints.json`, 번역 `result.json`, `library/`, `page-workflows/`, `runs/`, `models/`, `ocr-runtime/`, `hf-cache/`)은 여기에 있다. analysis가 말하는 "두 data root"는 개발용 repo data root와 설치 앱 data root다.
- 현재 위치는 Windows 로컬이다. 정확한 경로는 `사용자 확인 필요`(예전 노트의 개발 repo 경로 `D:\01_code\CarrotMangaTranslator`는 현재 값으로 확인되지 않았다). M1 진행 중 WSL에서 `/mnt/...`로 접근하도록 옮길 예정이다.
- 환경변수 이름이나 config key를 미리 정하지 않는다. 데이터가 필요한 Step에서 위치를 사용자에게 확인한다. 이 데이터는 사용자 데이터이므로 정리·삭제 대상이 아니다.

## Git 흐름

- 개인 repo다. PR은 필수가 아니고 에이전트가 `main`에 직접 commit/push한다.
- 흐름: 현재 HEAD/remote 확인 → fetch/pull → working tree clean 확인 → 작업 → validation → diff 검토 → commit → push → local/remote SHA 일치 확인.
- 큰 실험이나 위험한 변경은 필요하면 별도 branch를 쓴다.
- force push와 history rewrite는 사용자가 명시적으로 요청할 때만 한다.
- remote: `origin` = https://github.com/360F/RoverCMT. `carrot-original`(ucx0204 원본)은 로컬 설정이라 새 clone에는 없다. 원본 정보는 루트 [README](../README.md)를 따른다.

## CI / 테스트 정책

자동 CI는 꺼져 있다(루트 `.github/workflows/check.yml`은 원본 Carrot 앱 검사이며 `workflow_dispatch` 전용). 테스트는 당분간 수동으로 실행하고, 에이전트를 통한 자동 실행은 M2 이후 다시 정한다. M2 Golden benchmark는 commit/push CI가 아니며 일반 unit/smoke/regression test와 구분한다. Rover 전용 명령(2026-10-02, `RoverCarrot/`에서 실행):

- Node.js >=24; 개발 의존성은 `npm ci --ignore-scripts`로 이 하위 프로젝트에만 설치한다.
- `npm run build` — TypeScript build (`dist/`, gitignored)
- `npm run typecheck`, `npm run lint`, `npm test` — 독립 typecheck / ESLint / Node unit·CLI smoke
- `npm run smoke` — build 후 repository input/CLI smoke validation; 사용자 config 실행은 아래 CLI 사용
- `npm run check` — typecheck + lint + build/test
- `npm run check:boundaries` — parent runtime import 금지 및 Core/Pipeline → adapter import 금지 확인
- Linux CLI(`RoverCarrot/`에서 실행): `node dist/cli.js [--input <path>] [--output <path>]` — config는 project root의 `config/config.toml`(TOML), CLI 값이 config 기본값보다 우선, input/output 상대경로는 CWD 기준. 화면은 stage 진행률/PASS/FAIL만, 상세는 `logs/rovercmt.log`, 문제는 `logs/critical.log`(exit 0 PASS / 1 FAIL / 2 config 생성). 현재 dummy smoke 전용; 실제 stage 구현 아님
- 사용법과 최소 input/output contract: [README.md](README.md)

루트 Carrot 검사는 루트 ESLint global ignore의 `RoverCarrot/**`와 `.prettierignore`의 `/RoverCarrot/`로 Rover 코드를 제외한다. 루트 reference 의존성은 Rover 개발환경에 설치하지 않는다.

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
- parent CarrotMangaTranslator source를 RoverCMT runtime dependency로 직접 import하지 않는다. 이제 parent는 같은 repo의 루트 소스다. RoverCMT 코드는 루트 `src/`를 import하거나 루트 `package.json` 의존성에 기대지 않는다.
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