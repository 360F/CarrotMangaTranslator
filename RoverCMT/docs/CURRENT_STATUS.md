# RoverCMT Current Status

## 현재 단계

Phase 0 — 이식 가능성 분석 완료

현재는 실제 RoverCMT migration을 시작하기 전에
Electron-free renderer의 가능성을 검증하는 단계로 이동하고 있다.

RoverCMT production implementation은 아직 시작하지 않았다.


---

## 완료

- 프로젝트 기본 방향 정의
- migration 기본 원칙 정의
- Carrot automatic translation pipeline source trace
- 주요 component boundary 확인
- PORTABLE / ADAPTABLE / REPLACE / OPTIONAL 분류
- Windows/Electron/runtime dependency 확인
- Carrot이 사용하는 주요 backend/runtime inventory 확인
- upstream Linux compatibility 조사
- Linux independent Core 가능성 확인
- migration risk 재평가

현재까지의 상세 분석은 다음 문서에 있다.

`docs/analysis/INITIAL_MIGRATION_ANALYSIS.md`


---

## 현재 판단

Linux에서 독립적으로 실행되는 RoverCMT Core 구성은 현실적이다.

주요 detection, OCR, translation, inpainting runtime에는
Linux 실행 경로가 확인됐다.

따라서 현재 핵심 risk는
Linux용 기술 자체의 부재가 아니다.

주요 남은 risk는 다음이다.

- Carrot의 Windows/macOS 중심 packaging 분리
- exact dependency pin / native ABI / model configuration 검증
- runtime 간 integration
- Electron-free final rendering의 품질과 성능

특히 renderer는 모든 최종 출력 페이지의 품질에 영향을 주므로
실제 migration 전에 별도로 검증한다.


---

## 바로 다음 작업

**Renderer Feasibility & Candidate Analysis**

Carrot의 현재 Electron/Chromium renderer가 실제로 사용하는 기능을
source에서 확인하고,

동일한 결과를 Linux/headless 환경에서 구현할 수 있는
Electron-free renderer 후보를 조사한다.

이 단계에서는 renderer를 확정하거나 구현하지 않는다.

실제 comparison spike를 수행할 가치가 있는 후보를
2~3개로 좁히는 것이 목표다.


---

## 그 다음

`Renderer Candidate Analysis
→ Renderer Comparison Spike
→ 시각 품질 / 성능 확인
→ Renderer 방향 결정
→ RoverCMT Core migration 시작`

Renderer comparison에서는
현재 Carrot Chromium output을 reference로 사용하고
실제 Carrot page/layout data를 가능한 한 동일하게 입력한다.

pixel-perfect equality가 아니라
실제 사용 시 눈에 띄는 품질 저하가 없는지를 기준으로 판단한다.


---

## 이후 검증

실제 migration 과정에서 필요한 runtime은
각각 작은 smoke test로 exact 조합을 검증한다.

주요 대상:

- HayaiOCR
- PaddleOCR
- ONNX Runtime + Koharu
- Gemma + selected local server
- selected inpainting backend
- image/render supporting runtime

각 component가 준비된 뒤
대표 실제 페이지로 최소 end-to-end pipeline을 검증한다.


---

## 현재 상태

기존 CarrotMangaTranslator는
계속 reference implementation으로 유지한다.

RoverCMT는 아직 production code를 작성하지 않는다.

현재 checkpoint의 다음 행동은
renderer 후보 분석과 이후 comparison spike다.