# RoverCMT Development Notes

이 문서는 CarrotMangaTranslator 개인 fork `RoverCMT`의 현재 개발 상태와 의사결정 근거를 장기 보존하기 위한 handoff/checkpoint다. 확인된 구현, 실행 결과, 측정값만 기록하며 이후 작업에서 갱신한다.

## 1. 프로젝트 목적

- CarrotMangaTranslator v2.8.2 기반 개인 fork다.
- 현재 번역 품질과 inpainting 품질에 만족한다.
- 현재 결과 품질 유지가 최우선이다.
- 성능과 사용성은 기존 품질 및 semantics를 보존하는 변경부터 개선한다.

## 2. 환경

- OS: Windows 11
- 개발 repo: `D:\01_code\CarrotMangaTranslator`
- branch: `RoverCMT`
- upstream base: CarrotMangaTranslator v2.8.2
- Rover RTX 5090: `llama.cpp`/Gemma translation backend 실행
- 로컬 RTX 5070 Ti: Hayai CUDA OCR 및 Flux CUDA Native 실행
- RTX 5070 Ti는 현재 테스트 환경이며 최적화 목표 GPU로 하드코딩하지 않는다.

## 3. Gemma translation backend

- OpenAI-compatible `llama.cpp` endpoint를 사용한다.
- multimodal 입력은 `image_url`로 전달한다.
- Gemma thinking 문제를 피하기 위해 Extra body에 다음 값을 사용한다.

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

- 현재 translation 품질에 만족하므로 translation semantics, order, page context 전달은 현재 최적화 대상에서 제외한다.

## 4. Hayai OCR regression 및 해결

### 문제

v2.8 Page Workflow의 Hayai OCR stage는 page별 single-page path를 사용했다. 그 결과 page마다 Python/CUDA/model initialization이 반복됐다.

```text
N pages → N Python processes → N model loads
```

기존 batch path는 chapter의 여러 페이지를 한 Python process와 한 번의 model load로 순차 처리할 수 있었다.

### 해결

- 기존 batch OCR path를 Page Workflow production OCR stage에 다시 연결했다.
- 완료 receipt가 없는 `pendingPageIds`만 batch 준비 대상으로 사용한다.
- batch 결과는 page ID, input key, revision을 검증한 뒤 기존 page-serial 경계에서 적용하고 save/receipt한다.
- current v2.8 manifest 및 per-page save/receipt semantics를 유지한다.
- `workflowTargetBlocks`, `recognitionBboxes`, geometry, `effectRegions: []`, editable blocks semantics는 변경하지 않았다.
- 기존 single-page `collectOcrBboxHints` API는 호환성, 디버깅, focused test 용도로 유지한다.
- production batch 실패 시 N개의 single-page OCR로 fallback하지 않고 기존 workflow failure 경로로 전달한다.

```text
N pages → 1 batch Python process → 1 model load → sequential N-page OCR
```

### 관련 commits

- `a4c7e2ab Add page workflow performance profiling`
  - Page Workflow stage/page timing을 관측하기 위한 profiling commit이다.
  - OCR 실행 구조를 변경한 commit은 아니다.
- `e8efcecf Restore batched Hayai OCR in page workflow`
  - Page Workflow production OCR stage를 기존 Hayai batch path에 연결한 실제 OCR fix commit이다.

### 측정과 검증

- 기존 4-page OCR timing 합계: 약 86.7초
- batch restoration 이후 최종 검증 run: 약 31.9초
- 약 54.8초, 약 63% 감소했으며 약 2.7배 빠른 수준이다.
- 과거 첫 restored run의 약 59.0초와 최종 검증값을 혼동하지 않는다.
- retained-artifact run에서 4 pages가 하나의 `ocr-batch-*.json` request에 포함되고, 하나의 `ocr-batch-progress-*.jsonl`에서 1→2→3→4 순서로 처리됐으며, 4 outputs가 성공하고 OCR retry/fallback/error가 없음을 확인했다.
- retained-artifact run의 batch 자체 wall-clock은 약 22.91초였다. page timing OCR 합계 31,916ms는 batch 약 22,908ms와 detect 약 9,008ms의 합으로 artifact 및 log와 일치했다.
- 약 42-page 실제 작업에서도 동작을 확인했다.

## 5. Page Workflow 구조

확인된 stage order:

```text
detect → ocr → source-rules → translate → translation-rules →
typography → format-rules → erase → layout → review
```

- orchestration은 stage-major이며 각 stage 내부는 page-serial이다.
- translation은 이전 page의 story/style context를 다음 page에 전달한다.
- 단순 page parallelization은 현재 translation context와 순서를 바꾸므로 금지한다.
- OCR batch restoration은 translation semantics, order, context를 변경하지 않았다.

## 6. 42-page performance checkpoint

| 항목 | 측정값 |
| --- | ---: |
| 전체 workflow | 약 19분 52초 |
| OCR | 약 104.4초 |
| translation | 약 338.4초 |
| actual Flux inpainting | 약 359.0초 |
| typography | 약 13.2초 |
| preparing | 약 313.5초 |
| Flux crop count | 179 |

- `preparing` 대부분인 약 311초는 최초 Flux runtime preparation이었다. 이를 runtime이 준비된 정상 반복 실행 비용과 혼동하지 않는다.
- translation에는 empty-model-response retry로 약 100초가 걸린 anomaly page가 한 개 있었다.
- anomaly를 제외한 translation 시간은 약 238초다.

## 7. 현재 Flux inpainting 구조

- Windows NVIDIA path는 native `mgt-flux-klein.exe`를 사용한다.
- app과 runner는 persistent JSON-lines worker로 통신한다.
- model은 crop마다 reload하지 않고 worker lifetime 동안 재사용한다.
- `processFluxWindows`는 windows와 crops를 serial 처리한다.
- native runner `run_worker`도 request 하나를 synchronous하게 끝낸 후 다음 request를 처리한다.
- `koharu-ml`의 `Flux2Klein::inpaint`는 batch 1이다.
- app↔runner 사이에 PNG/file based path가 있다.
- 각 inpaint call 끝에 `CudaTemporaryMemoryCleanup`에서 synchronize 및 CUDA memory pool `trim_to(0)`를 수행한다.
- current crop은 mask 주변 context를 사용하며 `koharu` 내부에서도 mask bbox 주변으로 다시 crop한다.
- shared bitmap에 순차 composite하므로 overlapping crop은 처리 순서가 semantics에 영향을 줄 수 있다.

## 8. v1.20.1 Flux merge history

- 과거 CUDA Flux path에는 `mergeRects(inpaintWindows)`가 있었다.
- 이후 block ownership, composite mask, constraint 정보가 발전하면서 processing windows만 merge되고 parallel mask inventories는 개별 상태로 남아 index/alignment 문제가 발생했다.
- v1.20.1에서 Flux window merge를 제거했다.
- 당시 확인된 문제는 단순히 큰 crop의 품질이 나빴다는 것이 아니라 merged windows와 per-block mask inventory의 정합성 문제였다.
- 이 이력은 현재 merge를 다시 활성화해도 된다는 뜻이 아니다.
- merged inference는 context, order, resolution을 변경할 수 있으므로 품질 검증이 필요하다.

## 9. Flux 최적화 원칙

최우선 원칙은 현재 결과 품질을 유지하는 것이다. GPU utilization이나 VRAM utilization 자체가 목표가 아니라, 동일 품질과 semantics에서 wall-clock time을 줄이는 것이 목표다.

먼저 다음 조건을 유지하면서 제거할 수 있는 overhead를 조사한다.

- 동일 input image
- 동일 mask
- 동일 inference resolution
- 동일 model/steps/strength
- 동일 crop 처리 순서
- 동일 composite order/semantics

현재 우선 조사 대상:

- PNG encode/decode
- temporary file I/O
- CPU-side crop preparation
- GPU inference 사이 idle gap
- CUDA synchronize
- memory pool `trim_to(0)`
- resize/composite overhead
- 안전한 CPU/GPU pipelining 가능성

후순위 항목:

- crop/window merge
- page-level inpainting
- `maxPixels` 확대
- downscaling 정책 변경
- multi-worker/concurrent inference
- inference steps 변경

후순위 항목은 품질 또는 semantics를 변경할 수 있으므로 zero-quality-impact optimization을 충분히 검토한 뒤에만 실험한다.

## 10. 현재 다음 단계

아직 Flux 최적화 코드는 작성하지 않았다.

다음 작업은 현재 crop 1회의 lifecycle에서 다음 구간별 시간을 확인하는 것이다.

1. crop preparation
2. PNG encode/write
3. worker IPC
4. runner decode
5. VAE encode
6. Flux inference
7. VAE decode
8. output encode/write
9. app decode
10. resize/composite
11. CUDA synchronize/mempool cleanup
12. crop 사이 idle gap

먼저 기존 debug/timing 기능으로 측정 가능한 범위를 조사하고, 필요한 경우 품질과 semantics를 바꾸지 않는 최소 instrumentation 위치만 설계한다.

최초 목표는 **품질 영향 없는 Flux overhead 제거**다.
