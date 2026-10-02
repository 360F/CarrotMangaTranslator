# M4 — IDEAS

[M4 README](README.md) · [Planning index](../README.md)

아직 실험·구현을 결정하지 않은 최적화 후보다. 수치는 연결된 analysis 원문 그대로 인용한다.
모든 item은 M2 benchmark로 Before/After를 측정해야 하며, 품질 trade-off는 사용자가 결정한다.

| ID | Area | Title |
|---|---|---|
| [M4-TRANS-001](#m4-trans-001--hayai-ocr--vision-translation을-vision-llm-단독-ocrtranslation으로-통합) | Translation | Hayai OCR + Vision Translation을 Vision LLM 단독 OCR+Translation으로 통합 |
| [M4-TRANS-002](#m4-trans-002--previous-pass-blocks와-ocr-candidate-중복-제거) | Translation | Previous pass blocks와 OCR candidate 중복 제거 |
| [M4-TRANS-003](#m4-trans-003--output-recordschema-축소) | Translation | Output record/schema 축소 |
| [M4-TRANS-004](#m4-trans-004--page-context-trailer-빈도크기-축소) | Translation | Page-context trailer 빈도/크기 축소 |
| [M4-TRANS-005](#m4-trans-005--static-prompt-축소와-모순-제거) | Translation | Static prompt 축소와 모순 제거 |
| [M4-TRANS-006](#m4-trans-006--cache-friendly-promptmessage-ordering) | Translation | Cache-friendly prompt/message ordering |
| [M4-TRANS-007](#m4-trans-007--client-측-image-resizere-encode) | Translation | Client 측 image resize/re-encode |
| [M4-TRANS-008](#m4-trans-008--series-memory-개선) | Translation | Series Memory 개선 |
| [M4-TRANS-009](#m4-trans-009--glossarycharacter-memory-delta-only-갱신) | Translation | Glossary/character memory delta-only 갱신 |
| [M4-TRANS-010](#m4-trans-010--memory-correction과-provenance) | Translation | Memory correction과 provenance |
| [M4-TRANS-011](#m4-trans-011--degenerate-출력-감지와-finish_reason-검사) | Translation | Degenerate 출력 감지와 `finish_reason` 검사 |
| [M4-INPAINT-001](#m4-inpaint-001--단색저변동-말풍선-fast-erase와-flux-fallback) | Inpainting | 단색/저변동 말풍선 Fast Erase와 FLUX fallback |
| [M4-INPAINT-002](#m4-inpaint-002--flux-crop-수-감소) | Inpainting | FLUX crop 수 감소 |
| [M4-DETECT-001](#m4-detect-001--같은-원본-raster의-koharu-raw-inference-재사용) | Detection/Layout | 같은 원본 raster의 Koharu raw inference 재사용 |
| [M4-RUNTIME-001](#m4-runtime-001--modelsession-cache와-불필요한-reloadrecreation-제거) | Runtime | Model/session cache와 불필요한 reload/recreation 제거 |
| [M4-RUNTIME-002](#m4-runtime-002--gpu-lifecycle-최적화) | Runtime | GPU lifecycle 최적화 |
| [M4-PERSIST-001](#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선) | Persistence | Chapter 전체 JSON 반복 rewrite 비용 개선 |
| [M4-RENDER-001](#m4-render-001--선택된-linux-renderer-backend의-성능-최적화) | Renderer | 선택된 Linux renderer backend의 성능 최적화 |

---

## Translation

공통 근거: [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md). 이 분석은 저장된 실제 요청 218건으로 측정했고 "M1 blocker: 새 blocker는 없다"고 결론냈다(§18). 아래 아이디어는 M1 contract를 재현한 뒤에만 실험한다.

### M4-TRANS-001 — Hayai OCR + Vision Translation을 Vision LLM 단독 OCR+Translation으로 통합

- **Status:** IDEA
- **Summary:** `Detection → Hayai OCR → Vision Translation`을 `Detection → Vision LLM(OCR + Translation)`으로 바꾸는 실험. Hayai stage를 없앤다.
- **Why it matters:** 모델 출력 `jp`의 90%(1,129/1,254)가 OCR text와 정규화 후 완전히 같았고, 재판독 결과(`jp`)는 저장되지 않는다. 반면 현재 contract는 OCR을 구조적으로 필요로 한다.
- **Related analysis:**
  - [TR-LLM §14 OCR + Translation Consolidation Feasibility](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#14-ocr--translation-consolidation-feasibility) — block identity·bbox는 detection만으로 유지되지만 깨지는 contract 목록(대상 선정 gate, `ocrGeometryOnlyMode`, memory grounding, `sourceText` 하위 소비자).
  - [TR-LLM §11 OCR's Actual Role](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#11-ocrs-actual-role) — OCR이 gate·초안·grounding 근거라는 분석.
  - [OCR §9 Downstream Dependencies](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#9-downstream-dependencies) — OCR 결과를 쓰는 다른 stage.
- **Related items:** [M1-OCR-001](../M1_LINUX_PORT/CURRENT.md#m1-ocr-001--hayaiocr-linux-runtime).
- **Dependencies:** M1 완료, M2 benchmark(판독 정확도 비교 sample).
- **Decision / validation needed:** TR-LLM §14.4 제안 실험((a) 현재 요청 vs (b) `ocrText`를 뺀 요청)으로 `jp` 일치율과 `ko` 차이 측정. memory grounding을 자기 참조로 바꾸는 위험 판단 — 사용자.
- **History:** 2026-10-01 생성.

### M4-TRANS-002 — Previous pass blocks와 OCR candidate 중복 제거

- **Status:** IDEA
- **Summary:** 첫 번역 요청에서 `Previous pass blocks` section을 빼거나 candidate section과 통합한다.
- **Why it matters:** 실측에서 previous `jp`는 candidate `ocrText`와 1,188/1,188 동일했고, bbox 차이는 최대 1이었으며, 이전 번역 `ko`는 0/1,255건이었다. "관측 범위에서 이 section은 정보를 더하지 않는다."
- **Related analysis:**
  - [TR-LLM §6.1 같은 정보의 다중 표현](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#61-같은-정보의-다중-표현-fact) — 중복 측정.
  - [TR-LLM §19 Future Optimization Candidates #4](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#19-future-optimization-candidates) — "overwrite 재번역에서는 `ko`가 의미 있음" 주의.
- **Dependencies:** M2 benchmark.
- **Decision / validation needed:** overwrite 재번역 경로 처리 방법. 품질 A/B.
- **History:** 2026-10-01 생성.

### M4-TRANS-003 — Output record/schema 축소

- **Status:** IDEA
- **Summary:** keep-block 모드에서 출력을 `id`, `ko`(+필요 시 `textRole`/`confidence`) 위주로 줄이고, candidate 값을 복사하는 좌표·`jp`·`fontSize` 등을 빼는 실험.
- **Why it matters:** 생성 시간이 wall time의 76%다. record 1개는 median 160자인데 그중 `ko`는 median 9자이고, 좌표·`jp` 등은 최종 page state에 저장되지 않는다.
- **Related analysis:**
  - [TR-LLM §12.5 출력 구성](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#125-출력-구성-fact-문자-기준) — 출력 구성 측정.
  - [TR-LLM §13.1 로그로 증명된 것](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#131-로그로-증명된-것-fact) — 생성 비중.
  - [TR-LLM §19 #1](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#19-future-optimization-candidates) — validation(duplicate/overlap)이 출력 좌표와 `jp`를 쓰는 부분 재설계 필요.
- **Related items:** M4-TRANS-001(`jp` 재판독 이점과 연결).
- **Dependencies:** M2 benchmark.
- **Decision / validation needed:** token 단위 출력 구성 측정(TR-LLM §13.2 #3). 품질 회귀 판단 — 사용자.
- **History:** 2026-10-01 생성.

### M4-TRANS-004 — Page-context trailer 빈도/크기 축소

- **Status:** IDEA
- **Summary:** 매 page 생성하는 `<page-context>` trailer(visualSummary, glossary, characters)를 덜 자주 생성하거나, 크기를 줄이거나, 별도 호출로 분리한다.
- **Why it matters:** trailer는 출력 문자의 median 28.8%다. trailer 후보 중 glossary 70%(167/240), characters 83%(295/355)가 같은 요청에 이미 제공된 항목의 반복이었다.
- **Related analysis:**
  - [TR-LLM §12.5 출력 구성](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#125-출력-구성-fact-문자-기준) — trailer 비율.
  - [TR-LLM §15.2 제거 가능한 반복 추론](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#152-제거-가능한-반복-추론) — 줄일 수 있는 것이 주로 출력(inference)이라는 분석.
- **Related items:** M4-TRANS-008, M4-TRANS-009.
- **Dependencies:** M2 benchmark.
- **Decision / validation needed:** memory 신선도·품질 영향(TR-LLM §13.2 #6).
- **History:** 2026-10-01 생성.

### M4-TRANS-005 — Static prompt 축소와 모순 제거

- **Status:** IDEA
- **Summary:** 매 요청 동일한 정적 지시문을 줄이고, locked-slot 모드와 모순되는 detection/SFX 지시를 정리한다.
- **Why it matters:** prompt text의 약 79%가 정적 지시문이다. 가장 큰 section은 대부분 SFX 규칙인 `Rendering hints`(6,375자)다. 출력 record 1,534개 중 280개(18%)가 "새 id 금지" 지시를 어기고 candidate 밖 id를 썼다(원인은 INFERENCE).
- **Related analysis:**
  - [TR-LLM §6.2 locked-slot 모드와 정적 지시문의 모순](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#62-locked-slot-모드와-정적-지시문의-모순-fact-문구--inference-영향) — 모순 문구 목록.
  - [TR-LLM §12.2 section별 크기](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#122-section별-크기문자--median) — section별 문자 수.
  - [TR-LLM §19 #3](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#19-future-optimization-candidates).
- **Related items:** M4-TRANS-006.
- **Dependencies:** M2 benchmark.
- **Decision / validation needed:** 품질 회귀 A/B — 사용자.
- **History:** 2026-10-01 생성.

### M4-TRANS-006 — Cache-friendly prompt/message ordering

- **Status:** IDEA
- **Summary:** system + 정적 지시문 → 이미지 → 동적 section 순서로 바꿔 원격 server의 prefix cache를 활용한다.
- **Why it matters:** `cached_tokens`는 204/218건이 0이었다. 이미지가 system 직후에 있어 공통 prefix가 거기서 끊긴다.
- **Related analysis:**
  - [TR-LLM §12.3 Prefix cache](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#123-prefix-cache-fact) — cache 측정.
  - [TR-LLM §19 #5](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#19-future-optimization-candidates) — 이미지 위치 변경의 품질 영향과 server cache 설정 주의.
- **Related items:** M4-TRANS-005.
- **Dependencies:** M2 benchmark, server cache 설정 확인.
- **Decision / validation needed:** prefill 감소량 실측(TR-LLM §13.2 #4).
- **History:** 2026-10-01 생성.

### M4-TRANS-007 — Client 측 image resize/re-encode

- **Status:** IDEA
- **Summary:** 원본 page 파일을 그대로 base64로 보내는 대신, server의 실제 입력 해상도에 맞춰 client에서 줄이거나 재인코딩한다.
- **Why it matters:** 이미지 파일 크기 median 1.61 MB, max 6.79 MB(base64 median 약 2.15 MB)이고 client resize는 없다. server가 이미지를 몇 token으로 encode하는지는 UNKNOWN이다.
- **Related analysis:**
  - [TR-LLM §7 Vision Image Input](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#7-vision-image-input) — 인코딩 경로와 크기 측정.
  - [TR-LLM §19 #6](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#19-future-optimization-candidates) — server 입력 해상도와 맞추지 않으면 판독 저하 위험.
- **Dependencies:** server 이미지 처리 설정 확인(TR-LLM §22 #1).
- **Decision / validation needed:** 전송/디코드 시간 실측(TR-LLM §13.2 #2).
- **History:** 2026-10-01 생성.

### M4-TRANS-008 — Series Memory 개선

- **Status:** IDEA
- **Summary:** 작품 단위 persistent memory에 관계, 호칭, 상대별 말투 같은 구조를 추가하고, 현재 page와 관련 있는 항목만 선택적으로 넣는다.
- **Why it matters:** glossary/characters/rules는 이미 work 단위로 영속한다. 그러나 관계·호칭 구조가 없고 speechStyle은 단일 enum이며, 매 page 전체(≤80/≤40)를 재전송한다. 분석은 memory section이 prompt에서 차지하는 비중이 작다(median 2.1k자, 약 8%)고 기록했다.
- **Related analysis:**
  - [TR-LLM §15 Persistent Series Memory Feasibility](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#15-persistent-series-memory-feasibility) — 현재 구조와의 차이, consistency 장단점, 갱신 주의점.
  - [TR-LLM §9 Character Memory Lifecycle](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#9-character-memory-lifecycle) — 관계/호칭 구조 부재.
- **Related items:** M4-TRANS-009, M4-TRANS-010, [M3-TRANS-001](../M3_PIPELINING/IDEAS.md#m3-trans-001--translation-memory-순차-dependency-완화).
- **Dependencies:** M1-PERSIST-001(memory 의미 보존).
- **Decision / validation needed:** 선택적 투입의 대명사/별칭 누락 위험 A/B. 이 아이디어는 속도보다 일관성 효과가 클 수 있다 — 사용자 판단.
- **History:** 2026-10-01 생성.

### M4-TRANS-009 — Glossary/character memory delta-only 갱신

- **Status:** IDEA
- **Summary:** 이미 제공된 항목은 출력하지 않는 delta-only schema와 검증을 도입하거나, memory 추출 호출을 번역과 분리한다.
- **Why it matters:** glossary 후보 70%(167/240), character 후보 83%(295/355)가 반복이었다. 이미 캐릭터가 주어진 211 page 중 162 page는 출력한 character 후보가 전부 반복이었다.
- **Related analysis:**
  - [TR-LLM §8 Glossary Lifecycle](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#8-glossary-lifecycle) — 생성·merge·재투입 경로.
  - [TR-LLM §9 Character Memory Lifecycle](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#9-character-memory-lifecycle) — 반복 측정.
  - [TR-LLM §15.2](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#152-제거-가능한-반복-추론) — 후보 (a)–(c).
- **Related items:** M4-TRANS-004(trailer 자체 축소), M4-TRANS-008.
- **Dependencies:** M2 benchmark.
- **Decision / validation needed:** memory 품질 영향 — 사용자.
- **History:** 2026-10-01 생성.

### M4-TRANS-010 — Memory correction과 provenance

- **Status:** IDEA
- **Summary:** AI glossary/character 항목에 근거 page, 등장 횟수, 상태(`candidate`/`accepted`/`rejected`/`manual`)를 남기고, 충돌 시 버리지 않고 교정 후보로 보관한다. 재번역 시 근거 항목을 되돌릴 수 있게 한다.
- **Why it matters:** 현재 merge는 append-only이고 grounding target 근거는 같은 page의 모델 번역뿐이다. 첫 등록 오역이 작품 전체에 고정될 수 있다. 품질·정합성 아이디어지만 Translation memory 영역이므로 M4에 둔다.
- **Related analysis:**
  - [TR-LLM §8 Glossary Lifecycle](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#8-glossary-lifecycle) — 오류 누적 가능성(INFERENCE).
  - [TR-LLM §15.4 갱신 시 주의점](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#154-갱신-시-주의점-proposal) — 근거 분리, 수정 가능성, provenance, 재번역 일관성.
  - [CORE §17 Open Decisions #8](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#17-open-decisions-for-user) — AI glossary 자동 누적 유지/검토/비활성 선택지.
- **Related items:** M4-TRANS-008.
- **Dependencies:** M1-PERSIST-001.
- **Decision / validation needed:** 자동 누적 정책 — 사용자.
- **History:** 2026-10-01 생성.

### M4-TRANS-011 — Degenerate 출력 감지와 `finish_reason` 검사

- **Status:** IDEA
- **Summary:** 반복/퇴화 출력과 `finish_reason=length`를 감지해 꼬리 지연과 잘못된 번역 수용을 줄인다.
- **Why it matters:** 한 page가 completion 3,700 tokens, predicted 28.2 s의 반복 출력을 `finish:stop`으로 수용했다. finish_reason 검사 코드는 찾지 못했다.
- **Related analysis:**
  - [TR-LLM §13.1 로그로 증명된 것](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#131-로그로-증명된-것-fact) — 반복/degenerate 출력 행.
  - [TRANSLATION_PIPELINE §5.3 경우별 처리](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#53-경우별-처리) — truncated/degenerate 출력 처리 현황.
- **Dependencies:** 없음.
- **Decision / validation needed:** 감지 기준과 감지 시 동작(재시도/실패 표시) — 사용자. 사용자 초안 목록에는 없었고 TR-LLM §19 #10에서 추가했다.
- **History:** 2026-10-01 생성.

## Inpainting

### M4-INPAINT-001 — 단색/저변동 말풍선 Fast Erase와 FLUX fallback

- **Status:** IDEA
- **Summary:** 배경이 단색이거나 변동이 낮은 말풍선은 FLUX 대신 주변색 또는 말풍선 내부색으로 채우는 빠른 경로로 지우고, 품질 검사에 실패하거나 배경이 복잡한 영역만 FLUX로 보낸다. (사용자 초안의 "Fast Erase", "주변색/내부색 fill", "FLUX fallback" 세 항목을 하나의 아이디어로 묶었다.)
- **Why it matters:** 현재 production erase는 모든 대상 block을 FLUX crop 추론으로 처리한다. Flux crop은 median 1,535 ms(repo 두 run, 381 crops), 2,006 ms(설치 앱 run, 620 crops)였다.
- **Related analysis:**
  - [INPAINTING §1.3 Production path와 기타 path](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#13-production-path와-기타-path) — production은 Flux 단일 경로.
  - [INPAINTING §14 Real Library / Run Evidence](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#14-real-library--run-evidence) — crop 단위 시간.
  - [INPAINTING §5 Mask Generation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#5-mask-generation) — bubble constraint mask(fill 영역 정의에 재사용 가능한 후보).
  - 단색/저변동 말풍선 비율, fill 품질: `Evidence: not yet analyzed`.
- **Related items:** [M1-INPAINT-001](../M1_LINUX_PORT/CURRENT.md#m1-inpaint-001--flux-klein-candle-runner-linux-runtime), M4-INPAINT-002.
- **Dependencies:** M1-INPAINT-001, M2 benchmark.
- **Decision / validation needed:** 단색 판정 기준과 품질 gate. 품질 trade-off — 사용자.
- **History:** 2026-10-01 생성.

### M4-INPAINT-002 — FLUX crop 수 감소

- **Status:** IDEA
- **Summary:** window 병합, crop 계획(1MP 상한, tiling) 조정 등으로 page당 FLUX crop 수를 줄인다.
- **Why it matters:** crop 수가 erase 시간에 직접 비례한다(위 crop별 median). crop 계획은 window margin과 1,048,576 px 상한에 따라 정해진다.
- **Related analysis:**
  - [INPAINTING §5 Mask Generation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#5-mask-generation) — window margin, 공유 window 병합, crop 계획.
  - [INPAINTING §14 Real Library / Run Evidence](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#14-real-library--run-evidence) — crop 수와 시간.
- **Related items:** M4-INPAINT-001.
- **Dependencies:** M1-INPAINT-001, M2 benchmark.
- **Decision / validation needed:** 경계 품질 영향 — 사용자.
- **History:** 2026-10-01 생성.

## Detection / Layout

### M4-DETECT-001 — 같은 원본 raster의 Koharu raw inference 재사용

- **Status:** IDEA
- **Summary:** Detection stage, erase bubble prepass, layout stage가 같은 원본 raster로 Koharu layout을 최대 3회 추론하는 것을, raw detection artifact를 재사용해 1회로 줄인다. (사용자 초안의 "raw inference 재사용"과 "Detection/Erase prepass/Layout 중복 inference 감소"를 하나로 묶었다.)
- **Why it matters:** 세 호출의 model, 입력 raster, 전처리가 같다. 파생 결과(region, bubble 결과)는 재계산이 필요하지만 raw detections는 POSSIBLY REUSABLE로 판정됐다.
- **Related analysis:**
  - [DETECTION §8 Detector Mask Lifecycle — 3회 호출 검증](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#8-detector-mask-lifecycle--3회-호출-검증) — 세 호출 비교.
  - [DETECTION §23 Repeated Koharu Inference — Reuse Feasibility](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#23-repeated-koharu-inference--reuse-feasibility) — 재사용 판정표와 `DetectionArtifact` 후보 구조.
  - [CORE §17 Open Decisions #9](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#17-open-decisions-for-user) — detection 결과 보존 선택지.
- **Related items:** [M1-DETECT-001](../M1_LINUX_PORT/CURRENT.md#m1-detect-001--koharu-layout-onnx-linux-runtime).
- **Dependencies:** M1-DETECT-001.
- **Decision / validation needed:** DETECTION §25 #1–#2(raw mask 보존, cache 범위). provider 전환 시 수치 차이(UNKNOWN).
- **History:** 2026-10-01 생성.

## Runtime

### M4-RUNTIME-001 — Model/session cache와 불필요한 reload/recreation 제거

- **Status:** IDEA
- **Summary:** model과 session의 수명을 chapter/run 단위로 명시하고, 불필요한 dispose→재생성과 reload를 없앤다. (사용자 초안의 "model/session cache 최적화"와 "unnecessary reload/recreation 제거"를 하나로 묶었다.)
- **Why it matters:** FLUX는 30초 idle TTL pool이며 run당 model load 1회(2.47–10.66초)였다. Koharu session은 translation page마다 dispose된다. Translation endpoint session은 page마다 열고 닫히며, endpoint가 Ollama(port 11434)이면 page마다 unload 요청이 나가고 local `gemma` provider는 page마다 server를 재기동할 수 있다(현재 사용자 설정은 해당 없음).
- **Related analysis:**
  - [INPAINTING §6 Inpainting Runtime Lifecycle](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#6-inpainting-runtime-lifecycle) — FLUX pool, TTL, reload 조건.
  - [DETECTION §15 Runtime Lifecycle / Resource Ownership](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#15-runtime-lifecycle--resource-ownership) — Koharu session 생성/dispose 시점.
  - [TR-LLM §13.3 잠재 위험](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#133-잠재-위험-fact-code--inference-영향) — page별 endpoint session과 reload 위험.
- **Related items:** [M3-RUNTIME-002](../M3_PIPELINING/IDEAS.md#m3-runtime-002--koharu-session-lifecycle이-병렬화를-방해하는-문제)(병렬 lane 간 교차는 M3).
- **Dependencies:** M1 runtime item.
- **Decision / validation needed:** 재생성 1회 비용 측정(UNKNOWN).
- **History:** 2026-10-01 생성.

### M4-RUNTIME-002 — GPU lifecycle 최적화

- **Status:** IDEA
- **Summary:** 순차 실행에서 stage 전환 때 GPU runtime을 해제·재획득하는 순서를 줄이거나 명시적 owner/lease로 단순화한다.
- **Why it matters:** 현재 handoff는 OCR 전 inpainting 해제, translation 시작마다 detector 해제, erase에서 Flux 획득과 Koharu 재생성 순서다.
- **Related analysis:**
  - [CORE §8 Runtime / GPU Ownership Map](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#8-runtime--gpu-ownership-map) — handoff 순서.
  - [INPAINTING §6.3 GPU handoff timeline](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#63-gpu-handoff-timeline-fact).
- **Related items:** [M3-RUNTIME-001](../M3_PIPELINING/IDEAS.md#m3-runtime-001--pipelining을-위한-gpu-resource-scheduling)(병렬 scheduling은 M3).
- **Dependencies:** Linux GPU 환경, M1 runtime item.
- **Decision / validation needed:** CORE §17 #6 GPU ownership — 사용자.
- **History:** 2026-10-01 생성.

## Persistence

### M4-PERSIST-001 — Chapter 전체 JSON 반복 rewrite 비용 개선

- **Status:** IDEA
- **Summary:** stage 결과 저장마다 `chapter.json` 전체를 읽고 backup·fsync·rewrite하는 구조를 page 단위 persistence 또는 다른 storage 전략으로 바꾼다. (사용자 초안의 두 Persistence 항목을 하나로 묶었다.)
- **Why it matters:** 저장 1회 비용이 chapter 크기에 비례하고 저장 횟수는 page × stage다(전체 대략 O(N²), INFERENCE). `chapter.json`의 약 86%가 `bubbleLayout` 데이터다. 실제 병목인지는 UNKNOWN이다.
- **Related analysis:**
  - [INPAINTING §7 Long-run / Page-count Scaling Investigation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#7-long-run--page-count-scaling-investigation) — 저장 I/O 분석.
  - [CORE §14 Candidate Persistence Strategies](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#14-candidate-persistence-strategies) — A/B/C 비교.
- **Related items:** [M1-COMPAT-001](../M1_LINUX_PORT/CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability)(정의 확정: 출력은 Windows Carrot에서 열 수 있어야 한다. 내부 저장 방식은 바꿀 수 있지만 Carrot이 여는 형식은 유지해야 한다), [M1-PERSIST-001](../M1_LINUX_PORT/CURRENT.md#m1-persist-001--persistence와-data-contract-parity), [M3-STATE-001](../M3_PIPELINING/IDEAS.md#m3-state-001--공유-mutable-state-분리).
- **Dependencies:** M1-COMPAT-001(정의 확정, 2026-10-01), M2 benchmark(긴 sample).
- **Decision / validation needed:** 저장 시간 계측(현재 로그로 원인 구분 불가). M1에서 persistence 전략을 정하면 이 item은 일부 불필요해질 수 있다.
- **History:** 2026-10-01 생성. 2026-10-01 M1-COMPAT-001 정의 확정(Windows Carrot에서 open/use)에 맞춰 Related items·Dependencies 갱신.

## Renderer

### M4-RENDER-001 — 선택된 Linux renderer backend의 성능 최적화

- **Status:** IDEA
- **Summary:** M1에서 구현한 renderer backend(결정: Skia Canvas primary, 필요 시 Playwright Chromium fallback)의 cold start, page당 render 시간, memory를 줄인다. 기존 advanced rendering capability를 성급하게 삭제하지 않는다.
- **Why it matters:** v3 1회 관측에서 Skia Canvas eight-page total 4223.59 ms, Playwright Chromium 6628.41 ms였고, Playwright browser process tree는 333.3–446.1 MiB였다.
- **Related analysis:**
  - [RENDERER_CONTRACT_ALIGNED_RECOMPARISON §13 Performance](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#13-performance) — 성능·memory 관측.
  - [CORE §16 What NOT to Migrate](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기) — advanced renderer field는 현재 미사용이지만 schema를 optional로 남기라는 권장.
- **Related items:** [M1-RENDER-001](../M1_LINUX_PORT/CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback)(M1 결정: Skia Canvas primary, Playwright Chromium fallback/reference).
- **Dependencies:** M1-RENDER-001의 Skia 구현(또는 fallback 시 Playwright).
- **Decision / validation needed:** steady-state workload와 memory 측정 방법(RECOMPARISON §17 #6).
- **History:** 2026-10-01 생성. 사용자 초안의 "Skia Canvas vs Chromium 성능/복잡도 검토"는 M1-RENDER-001의 backend 선택 과정으로 옮겼다. 2026-10-01 M1 renderer 결정(Skia primary)에 맞춰 Summary·Dependencies 갱신.
