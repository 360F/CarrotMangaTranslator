# RoverCMT Analysis Plan

## 현재 상태

초기 이식 가능성 분석은 완료됐다.

CarrotMangaTranslator의 실제 자동 번역 pipeline을 source에서 추적했고,
주요 component의 dependency와 Linux 이식 가능성을 분류했다.

추가로 Carrot에서 사용하거나 지원하는 주요 backend/runtime의
upstream Linux 지원 여부를 조사했다.

현재 결론은 다음과 같다.

- Linux에서 독립적으로 실행되는 RoverCMT Core 구성은 현실적이다.
- 주요 OCR, detection, translation, inpainting runtime에는 Linux 실행 경로가 존재한다.
- Carrot의 Windows/macOS 중심 packaging은 Core에서 분리해야 한다.
- exact dependency/model/runtime 조합은 실제 smoke test가 필요하다.
- Electron-free final rendering의 품질은 아직 검증되지 않았다.
- RoverCMT production migration은 아직 시작하지 않았다.

상세 근거는 다음 문서에 기록한다.

`docs/analysis/INITIAL_MIGRATION_ANALYSIS.md`


---

## 1. 다음 검증 목표

현재 가장 먼저 검증할 항목은 final renderer다.

Carrot의 현재 final output은
Electron/Chromium의 DOM, CSS, font shaping 및 offscreen rendering에 의존한다.

RoverCMT Core는 장기적으로 Electron에 종속되지 않는 것을 목표로 한다.

따라서 다음 질문을 production migration 전에 확인한다.

**Electron/Chromium 기반 Carrot renderer를 Core에서 제거하더라도
실제 번역 만화의 typography/layout/render 품질을
실용적으로 유지할 수 있는가?**

이 검증은 두 단계로 진행한다.

1. Renderer Feasibility & Candidate Analysis
2. Renderer Comparison Spike


---

## 2. Renderer Feasibility & Candidate Analysis

먼저 Carrot의 현재 renderer가 실제로 사용하는 기능을 source에서 확인한다.

일반적인 renderer 기능 목록을 추측해서 비교하지 않는다.

실제 Carrot output에 필요한 기능을 기준으로 후보를 평가한다.

확인 대상에는 필요에 따라 다음이 포함된다.

- CJK glyph shaping
- Korean/Japanese text
- horizontal text
- vertical text
- line wrapping
- font measurement
- font fallback
- alignment
- font weight/style
- outline/stroke
- letter spacing
- rotation
- transform
- clipping
- opacity
- custom font loading
- image composition
- large page handling
- PNG output
- Linux/headless operation

Carrot source에서 실제로 사용하지 않는 기능은
단순히 가능성이 있다는 이유만으로 필수 요구사항으로 만들지 않는다.


### Candidate 조사

Carrot의 실제 요구사항을 기준으로
Electron-free Linux/headless renderer 후보를 조사한다.

각 후보에 대해 최소한 다음을 확인한다.

- Linux 지원
- headless 실행
- Node 또는 Core integration 방법
- text shaping 방식
- CJK 지원
- vertical text 지원
- font fallback
- font measurement
- stroke/outline
- transform
- image composition
- native dependency
- distribution/build 방식
- 유지보수 상태

이 단계에서는 renderer를 확정하지 않는다.

기능적으로 부적합한 후보를 제거하고
실제 comparison spike를 수행할 가치가 있는 후보만 2~3개로 좁힌다.


---

## 3. Renderer Comparison Spike

후보가 정해지면
production RoverCMT와 분리된 작은 실험 환경을 만든다.

목적은 renderer implementation 자체가 아니라
시각 품질과 성능의 비교다.


### Reference

현재 Carrot의 Electron/Chromium renderer output을
reference로 사용한다.


### Input

가능하면 인위적인 sample만 사용하지 않고
기존 Carrot에서 정상 처리된 실제 페이지의
image/layout/translation/font 관련 데이터를 fixture로 사용한다.

모든 renderer에는 가능한 한 동일한 입력을 전달한다.


### Test corpus

대표 fixture에는 필요에 따라 다음 경우를 포함한다.

- 일반 dialogue
- 긴 dialogue
- 작은 bubble
- 여러 줄 wrapping
- CJK text
- vertical text
- mixed-language text
- outline/stroke
- rotation/transform
- 특수문자
- 큰 페이지

실제 Carrot 기능에서 사용하지 않는 case를
억지로 benchmark에 추가하지 않는다.


### 비교 항목

시각 비교:

- line wrapping
- glyph shaping
- font size
- font fallback
- alignment
- vertical text
- outline
- transform
- clipping
- 전체적인 말풍선 내 균형
- 최종 raster 품질

성능 비교:

- cold start
- page render time
- 여러 페이지 연속 render time
- peak memory
- failure 여부

필요하면 image diff를 생성할 수 있지만
pixel-perfect equality를 품질 기준으로 사용하지 않는다.

anti-aliasing 또는 rasterization 차이는 허용한다.


### 성공 기준

핵심 성공 기준은 다음이다.

**실제 번역 만화를 읽었을 때
Electron-free renderer가 현재 Carrot output보다
눈에 띄게 품질이 떨어지지 않는다.**

최종 시각 품질은 자동 metric만으로 결정하지 않는다.

comparison output을 사람이 직접 확인한다.


---

## 4. Renderer 검증 이후

### 성공하는 후보가 있는 경우

renderer 방향을 결정하고
실제 RoverCMT Core migration 단계로 이동한다.

그 이후 필요한 component를 작은 단위로 이식하면서
각 runtime의 exact pin/config/ABI smoke test를 수행한다.


### 모든 후보가 품질 기준에 미달하는 경우

Electron 제거 자체를 억지로 진행하지 않는다.

다음 대안을 다시 검토한다.

- 다른 native/headless renderer
- browser engine 기반 headless renderer
- Chromium을 Core와 분리된 rendering adapter/service로 사용하는 방법

목표는 Electron 제거 자체가 아니라
Linux에서 독립적으로 실행 가능한 Core와
충분한 최종 출력 품질을 동시에 확보하는 것이다.


---

## 5. 이후 Runtime Smoke Tests

Renderer 검증과 별개로,
실제 migration 과정에서는 다음 exact runtime 조합을 검증한다.

- HayaiOCR
- pinned Paddle stack
- ONNX Runtime + Koharu model
- Gemma GGUF + selected server
- selected inpainting backend
- 필요한 image/FFmpeg path

Smoke test에서는 전체 production pipeline을 만들지 않는다.

각 runtime에 대해 다음 정도만 확인한다.

- 설치 또는 실행 가능
- model load 가능
- 대표 input 1개 처리 가능
- 기대하는 output contract 생성
- 필요한 경우 GPU 사용 가능

upstream Linux 지원 여부를 다시 조사하는 것이 아니라
RoverCMT에서 사용할 정확한 조합을 검증하는 것이 목적이다.


---

## 6. End-to-End 검증

주요 component가 준비되면
대표 실제 페이지를 대상으로 최소 E2E pipeline을 검증한다.

`Input
→ Detection
→ OCR
→ Translation
→ Erase
→ Typography/Layout
→ Render
→ Output`

이 단계에서 확인한다.

- component contract가 정상 연결되는가
- 실제 결과물이 생성되는가
- 실패 시 어느 stage에서 실패했는지 알 수 있는가
- 번역 결과가 실용적인 품질인가
- time-to-output이 실용적인가


---

## 7. 현재 단계에서 하지 않는 것

Renderer candidate analysis 전에는 다음을 하지 않는다.

- RoverCMT production architecture 확정
- production pipeline 구현
- Carrot 전체 pipeline 복사
- 대규모 migration
- 모든 runtime installer 구현
- 모든 backend 지원
- editor/review migration
- 복잡한 retry/recovery 구현
- 기존 Carrot production source 변경

현재 목표는
가장 중요한 미검증 품질 risk를 작은 실험으로 먼저 제거하는 것이다.


---

## 8. 바로 다음 작업

다음 작업은:

**Renderer Feasibility & Candidate Analysis**

이다.

결과는 별도의 analysis 문서로 남긴다.

이 분석이 끝나기 전에는
renderer candidate를 확정하거나
comparison implementation을 시작하지 않는다.