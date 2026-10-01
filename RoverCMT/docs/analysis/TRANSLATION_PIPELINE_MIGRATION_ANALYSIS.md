# Translation Pipeline Migration Analysis

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M1 Linux Port](../milestones/M1_LINUX_PORT/README.md) — translation 이식 경계와 smoke 계획
- [M3 Pipelining](../milestones/M3_PIPELINING/README.md) — stage-major 실행과 병렬 경로 진입 조건
- [M4 Optimization](../milestones/M4_OPTIMIZATION/README.md) — degenerate 출력 처리 현황

Tracking: [M1 CURRENT](../milestones/M1_LINUX_PORT/CURRENT.md) · [M3 IDEAS](../milestones/M3_PIPELINING/IDEAS.md) · [M4 IDEAS](../milestones/M4_OPTIMIZATION/IDEAS.md)

## 0. Scope and Evidence Rules

이 문서는 CarrotMangaTranslator의 production translation pipeline을 source와 read-only local artifact로 추적한 결과다. 목적은 Linux RoverCMT Core로 옮길 translation boundary를 정하는 것이다. 이번 작업에서 하지 않은 것은 다음과 같다.

- 구현, dependency 설치, model 다운로드, runtime 실행
- Carrot source, library, 기존 문서, renderer 관련 파일 수정

표기 규칙:

- **[FACT]** source 또는 local artifact에서 직접 확인했다.
- **[INFERENCE]** 확인된 사실에서 도출했지만 실행으로 검증하지 않았다.
- **[UNKNOWN]** 이번 조사로 확인할 수 없었다.
- **[RECOMMENDATION — USER DECISION REQUIRED]** 제안이며 사용자 결정이 필요하다.

선행 문서: `INITIAL_MIGRATION_ANALYSIS.md` §3.4, `OCR_RUNTIME_MIGRATION_ANALYSIS.md`.

Local evidence는 repo data root와 설치 앱 data root의 library, run artifact, settings를 조사 시점에 읽은 것이다. 설치 앱 library에는 조사 도중 새 chapter(`b909e2ad…`)가 생겼다. 사용자가 Carrot을 계속 사용 중이므로 수치는 해당 시점 snapshot이다. 번역문, 원문, glossary 용어, 내부 네트워크 주소, 사용자 경로는 이 문서에 옮기지 않았다.

### 핵심 요약

1. **[FACT]** production translation은 텍스트 번역 호출이 아니다. page마다 한 번씩 **원본 page 이미지(base64) + OCR 후보 + 이전 block + glossary/story memory**를 vision LLM에 보낸다. 모델은 이미지에서 일본어를 다시 읽고(OCR text는 "reading hint") 번역한다.
2. **[FACT]** 두 data root의 실제 번역 결과 207건은 모두 `modelProvider="openai-api"`다. Carrot managed Gemma/llama-server가 아니라 LAN의 OpenAI 호환 endpoint로 Gemma 4 26B GGUF를 호출했다.
3. **[FACT]** 모델이 일부 block을 빠뜨려도 page는 `completed`로 저장된다. 현재 library에서 `sourceText`는 있지만 `translatedText`가 빈 block이 completed page에 87개 있다.
4. **[FACT]** 모델 출력의 page-context trailer가 work glossary/characters로 자동 저장되고, 다음 page prompt에 다시 들어간다. 현재 glossary 49개 전부 `origin:"ai"`다.
5. **[INFERENCE]** local `gemma` provider라면 staged workflow는 page마다 endpoint session을 열고 닫는다. 그래서 llama-server가 page마다 spawn/종료될 수 있다(§9.2).

## 1. Production Translation Flow

### 1.1 Stage 진입

- **[FACT]** staged workflow의 stage 순서는 `detect → ocr → source-rules → translate → translation-rules → typography → format-rules → erase → layout → review`다.
  - `executeWorkflowStage`가 `stage === "translate"`일 때 `translateWorkflowPage`를 호출한다(`src/main/pageWorkflow/pageWorkflowRuntime.ts:162`).
  - 실행 순서는 **stage-major**다. 모든 page의 한 stage를 page 순서대로 마친 뒤 다음 stage로 간다(`src/main/application/pageWorkflowService.ts` `executeWorkflowChapter`, `executeWorkflowPages`).
- **[FACT]** `plan.experimentalParallelAcceleration`(사용자 설정 `api.experimentalParallelAcceleration=true`)이 켜져 있고 조건(local erase, translate+erase 포함, format-rules 없음)이 맞으면 `executeExperimentalParallelChapter`가 쓰인다.
  - 이 경로는 translation과 deferred erase를 `Promise.allSettled`로 겹친다(`pageWorkflowExperimentalParallel.ts:147`).
  - translation 자체는 여전히 `executeWorkflowPages`로 page 순차다.

### 1.2 호출 경로

1. `translateWorkflowPage` (`pageWorkflow/pageWorkflowTranslation.ts:8`)
   - `assertWorkflowSource` (`:107`): `sourceText`가 빈 block이 있으면 예외. 단, 이미 번역이 있고 translate를 overwrite하지 않으면 통과한다.
   - `workflowTargetBlocks(page, "translate", plan)`로 대상 block만 담은 page 사본을 만든다.
   - `resolveWorkContextForChapter(chapter.id)`로 style guide(glossary/characters/rules)와 chapter story memory를 읽는다.
   - `buildKeepBlocksOcrResult(input, blocks.map(b => b.sourceText))` (`pipeline/keepBlocksResult.ts:43`)로 hint를 만든다. hint `id = index+1`, `label:"block"`, pixel bbox, `ocrText = sourceText`.
   - `runWholePagePipeline({ pages:[input], blockMode:"keep", preparedOcrHints, autoFontMatching:false, aiFontSizeMatching:false, naturalTextLayout:false, collectPageContext: plan.cumulative, workContext:{…, recentPageCount:6, previousStoryPages} }, context.dependencies)`
2. `runWholePagePipeline` (`src/main/wholePagePipeline.ts:77`) → `prepareWholePageRun`
   - `preparedOcrHints`가 있으므로 OCR을 다시 실행하지 않는다(`:569`).
   - → `filterPagesByOcrText` → `completeWholePageRun` → `preparePagesWithinEndpointSession`
3. `startWholePageEndpoint` → `startAnalysisEndpointSession` (`pipeline/endpointSession.ts`) → `TranslationRuntimePort.startEndpointSession` (`pipeline/translationRuntimePort.ts`) → `startModelEndpointSession` (`pipeline/runtimeModules.ts`). provider별 endpoint는 §2.
4. `preparePageWithRetries` (`pipeline/translatePageWithRetries.ts`)
   - `buildRequestPageOptions` (`pipeline/pageResultBuilder.ts:91`)로 요청 option을 만든다.
   - `preparePageTranslationAttempt` (`pipeline/pageTranslationAttempt.ts`)가 `assertNoFailedHayaiOcr`를 먼저 확인한다.
   - 그다음 `runtime.requestTranslation(server, pageOptions)` → `saveArtifacts` → `preparePageResult`.
5. `requestTranslation` (`runtime/transport/translation-request.cjs:73`, CJS runtime module)
   - `collectOcrBboxHints(options)`: `options.ocrBboxResult`가 있으면 재정규화한다(§3.4).
   - `createPromptOptions`, `shouldSkipModelRequest`
   - fixed-block/group-review 경로 선택(§1.3)
   - `prepareTranslationRequest` (`:246`): image variant, prompt, system prompt, request body
   - `requestChatTranslation` (`:384`): `fetch(${baseUrl}/chat/completions)`
6. `preparePageResult` (`pageResultBuilder.ts:252`)
   - `parsePageResponse` (`pageResponseParser.ts:110`)로 page-context trailer를 분리하고 record를 parse한다.
   - `applyGlossaryOmissionsToOverlayItems`, `validateOverlayItemsAgainstReferences`, 불확실 SFX 제거를 적용한다.
   - keep mode면 `buildKeepBlocksCompletedPage`로 기존 block에 결과를 반영한다.
7. `finalizeTranslatedPages`: page 완료 처리와 page context/story memory 저장(§3.6)
8. `translateWorkflowPage`로 돌아온 뒤:
   - 결과 page가 없거나 `analysisStatus==="failed"`면 예외
   - 아니면 `mergeWorkflowTranslations` (`:76`)
9. `executeWorkflowPage` (`pageWorkflowService.ts:251`)가 `port.save(chapterId, before, completeWorkflowReceipt(…))`로 chapter를 저장한다. **이 시점에 `translatedText`가 최종 page state에 저장된다** [FACT].

### 1.3 Production path와 비사용 path

| Path | Staged workflow에서 사용 | 근거 |
|---|---|---|
| Overlay prompt (`promptMode: overlay_bbox_lines_multiview`) + chat completion | **사용** | [FACT] source 경로와 local result 207/207 |
| Fixed-block translation (`semantic-ocr/fixed-block-*.cjs`, `requestFixedBlockTranslation`) | 사용 안 함 | [FACT] `isHayaiLockedRegionMode`는 모든 hint에 `geometryLocked===true`를 요구한다. keep-block hint에는 이 값이 없다. [INFERENCE] OCR 원본 hint가 그대로 전달되는 non-workflow Hayai 경로에서 쓰인다 |
| Group-only page review | 사용 안 함 | [FACT] `isGroupOnlyReviewEligible`이 `!keepBlocksMode`를 요구한다 |
| Region crop / sound-effect translation | 사용 안 함(별도 기능) | [FACT] `regionCropMode`, `soundEffectTranslationMode` flag가 staged translate에서 설정되지 않음 |
| Codex (`openai-codex`) Responses API | provider 선택 시 | [FACT] `requestCodexTranslation` |
| Translation checkpoint 재사용 | staged translate가 전달하지 않음 | [FACT] `translationCheckpoints` 미지정 |

## 2. Translation Backend / Runtime Inventory

`ModelProvider = "gemma" | "openai-codex" | "openai-api"` (`src/shared/settingsTypes.ts:32`) [FACT].

| Backend | Production 사용 | 호출 방식 | Process / binary | Platform coupling | Model |
|---|---|---|---|---|---|
| **openai-api** (OpenAI 호환: llama.cpp server, Ollama, 기타) | **local evidence상 유일한 사용 backend** | `fetch POST {apiBaseUrl}/chat/completions`, 비스트리밍. endpoint 생성은 객체만 만든다(`src/main/openaiApiEndpoint.ts`) | 없음(외부 server). 종료 시 `releaseOllamaLocalModel` 호출 | Node `fetch`만 사용 [FACT] | 설정한 `api.model` 문자열 |
| **gemma** (managed llama-server / BeeLlama / Lemonade ROCm) | 설정 가능. local evidence 없음 | `runtime.simplePage.startServer` → `spawn(llama-server)` → `http://127.0.0.1:{port}/v1/chat/completions` | managed binary catalog. `MANGA_TRANSLATOR_LLAMA_SERVER_PATH` override 가능 | catalog는 Windows zip(`llama-server.exe`, CUDA DLL)과 macOS arm64만 있고 **Linux 항목은 없다** [FACT] (`runtime/simple-page-llama-runtimes.cjs`). Windows 종료는 process tree kill, 그 외 `SIGTERM` | HF GGUF + mmproj 자동 다운로드(`ensureHfModelAssetsDownloaded`) |
| **openai-codex** | 설정 가능 | Codex app-server + Responses API | `codexAppServerEndpoint.ts` (별도 process) | 외부 CLI/protocol | 설정한 codex model |

### 2.1 Local evidence

**[FACT]** 두 data root의 모든 `runs/*/pages/*/attempt-*/result.json` 207건:

| 항목 | repo data root (99건) | 설치 앱 data root (108건) |
|---|---|---|
| `settings.modelProvider` | `openai-api` 99 | `openai-api` 108 |
| `requestSummary.promptMode` | `overlay_bbox_lines_multiview` 99 | 동일 108 |
| endpoint | LAN host (loopback 아님) | LAN host |
| model | `gemma-4-26B-A4B-it-ultra-uncensored-heretic.Q6_K.gguf` | 동일 |
| finish_reason | `stop` 99 | `stop` 108 |
| prompt tokens (median / max) | 7,325 / 8,667 | 7,608.5 / 8,835 |
| completion tokens (median / max) | 677 / 2,078 | 831 / 3,700 |
| server가 보고한 생성 속도 median | 125.9 tok/s | 126.3 tok/s |
| attempt-2 존재 | 1 page | 1 page |

**[FACT]** 두 `settings.json`의 공통 값:
- `modelProvider="openai-api"`, `api.provider="custom"`
- `api.extraBodyJson={"chat_template_kwargs":{"enable_thinking":false}}`
- `translation.sourceLanguage="ja"`, `targetLanguage="ko"`, `maxTokens=8192`
- `ctx`: repo 131072, 설치 앱 65536

**[INFERENCE]** endpoint의 model 경로(`/models/…gguf`), `timings`, `prompt_tokens_details.cached_tokens` 응답 필드로 보아 원격 server는 llama.cpp 계열로 보인다. 원격 server의 binary, version, GPU는 **[UNKNOWN]**이다.

### 2.2 Dependency 요약

- **Node**: `fetch`, `node:child_process`(local server, FFmpeg), `node:fs` [FACT]
- **Electron**:
  - `appPaths` → `runtimeModuleLoader`로 CJS runtime 경로를 결정한다 [FACT].
  - `resolveImageSize`는 option에 width/height가 없으면 Electron `nativeImage`로 크기를 읽는다(`runtime/assets/image-source-assets.cjs`) [FACT].
  - enhanced variant는 Electron/PowerShell 구현이 있다 [FACT].
  - 외부 provider용 `prepareExternalImageFile`(image redaction)은 `nativeImage`를 import한다(`src/main/imageRedactionContext.ts`) [FACT].
- **FFmpeg**: `.webp` 입력은 PNG 변환에 FFmpeg를 spawn한다(`fileToModelAsset`) [FACT].
- **Python**: translation 경로에는 없다 [FACT, 확인한 범위 기준].
- **GPU**: `openai-api`에서는 Carrot 측 GPU를 쓰지 않는다. `gemma`는 local llama-server의 GPU를 쓴다 [FACT].
- **Env**: `MANGA_TRANSLATOR_PAGE_RETRIES`(기본 5), `MANGA_TRANSLATOR_LLAMA_SERVER_PATH`, `MANGA_TRANSLATOR_LLAMA_PORT`, `MANGA_TRANSLATOR_ALLOW_LLAMA_SERVER_REUSE`, `MANGA_TRANSLATOR_LLAMA_RUNTIME_PROFILE`, `MANGA_TRANSLATOR_LLAMA_CACHE_DIR` 등 [FACT].

## 3. Prompt Construction

### 3.1 Message 구조

**[FACT]** `buildMessages` (`runtime/simple-page-request-builders.cjs:83`):

- `system`: text 1개
- `user`: 이미지 variant마다 `[image_url(dataUrl), text(variant 설명)]`, 마지막에 prompt text
- 기본 image variant는 `role:"original"`, `path = options.imagePath = page.imagePath`다. 이는 **inpaint 전 원본 page**다(`pipeline/options.ts:38`).
- enhanced variant는 기본으로 꺼져 있다. `empty-overlay-items` 실패 후 재시도할 때만 켜진다(§6).

**[FACT]** `openai-api` request body (`buildChatRequestBodyWithModelResolver`, `:273`):
- `{model, max_tokens, messages, temperature?, top_p?, top_k?, reasoning_effort?, ...extraBody}`
- `response_format`이나 JSON schema 강제는 없다.
- `gemma` provider는 여기에 `presence/frequency_penalty 0`, `reasoning_budget`, `enable_thinking`, `chat_template_kwargs`를 붙인다.

### 3.2 System prompt

**[FACT]** `buildSystemPrompt`(`runtime/prompts/system-prompt.cjs`)가 만든다. local result 기준 약 1.8k자다. 내용은 다음과 같다.

- OCR/manga 번역 engine 역할과 machine-readable record만 출력
- geometry 우선, 말풍선 병합 금지, 중복 record 금지
- ordinary 한국어는 가로쓰기, SFX 규칙과 SFX confidence 규칙
- strict refinement와 fixed-blocks 규칙: candidate id 재사용, 새 id 금지

### 3.3 User prompt section과 출처

`buildOverlayPrompt` (`runtime/prompts/overlay-prompt.cjs:108`)가 기본 section에 선택 section을 끼워 넣는다. local result 1건(약 23k자)의 실제 section 순서와 출처는 다음과 같다 [FACT].

| Section | 출처 | 번역에 들어가는 정보 |
|---|---|---|
| Task | `task-sections.cjs` `buildTaskSection` | 전체 page 이미지, fixed-blocks refinement, candidate 밖 출력 금지 |
| Output | `OVERLAY_PROMPT_SECTIONS` + `SMALL_GEMMA_DUPLICATE_*` | plain text record 형식(§5), `[?]` 규칙, 숫자 보존 규칙 |
| Coordinate calibration | `coordinates.cjs` | 원본 크기와 `normalized 0..1000` 좌표계 |
| Strict refinement mode | `buildStrictRefineSection` | candidate당 record 1개, "ocrText hint를 primary reading evidence로 검증 후 번역", story memory는 약한 참고 |
| Work glossary and story memory | `work-context.cjs` `buildWorkContextSection` | enabled glossary(target 있는 항목), omission term, characters, story memory page 요약, `rules`(honorifics, sfxMode, defaultTone) |
| Previous pass blocks | `previous-pass.cjs` | 대상 block마다 `candidateId`, bbox(0–1000), role, confidence, `jp`(=기존 `sourceText`), 기존 `ko` |
| Locked ordinary-text regions (HayaiOCR) | `ocr-bbox-section.cjs` | "Hayai OCR text는 reading hint이고 geometry 권위가 아님", candidate id 목록, `candidate N: label:block x1..y2 score ocrText:"…"` |
| Geometry / Segmentation / Rendering hints | 정적 section | bbox, direction, fontSize, SFX 규칙(ja→ko 전용 문구 다수) |
| Page context trailer | `page-context.cjs` (`collectPageContext`일 때) | `<page-context>{visualSummary, glossary, characters}</page-context>` 출력 요구 |

- **[FACT]** 여러 block을 **한 번에(page 단위)** 보낸다. 순서는 대상 block 배열 순서이고 candidate id = index+1이다.
- **[FACT]** 주변 context는 같은 page의 모든 block(이미지 포함)과 story memory다. story memory는 `recentPageCount:6`과 `previousStoryPages`로 구성하고, `prunePromptWorkContextForBudget({ctx, maxTokens})`로 예산 안에 자른다.
- **[FACT]** 언어는 `sourceLanguage`/`targetLanguage` option을 쓴다. 문구는 `localizePromptTextForProfile`로 language profile에 맞춰 바꾼다. 기본 문구는 일본어→한국어를 전제로 쓰였다.
- **[FACT]** `strictRefineMode`일 때 sampling을 `temperature ≤ 0.1`, `topP ≤ 0.85`, `topK ≤ 32`로 제한한다(`applyStrictRefineOptions`, `pageResultBuilder.ts:578`).
  - 이 제한은 `pageOptions.temperature`에 적용된다. `openai-api` body는 `resolveConfiguredApiTemperature`(api 설정)를 쓴다.
  - local result의 `apiTemperature: 0.2`와 settings 값이 일치한다.
  - **[INFERENCE]** 따라서 strict 제한은 local gemma에만 적용되고 `openai-api`에는 적용되지 않는 것으로 보인다. 실제 전송 body의 temperature 값은 확인하지 않았다 [UNKNOWN].

### 3.4 OCR sanitize와 prompt의 관계

- **[FACT]** OCR stage는 Hayai 출력 text에 `sanitizeOcrTextForPrompt`를 적용해 저장한다. 내용: ja noise 제거, glossary omission, control 문자 제거, **160자 절단**(OCR 문서 §8.2).
- **[FACT]** translate stage는 저장된 `sourceText`로 `buildKeepBlocksOcrResult` hint를 만들어 `pageOptions.ocrBboxResult`에 넣는다(`applyOcrHintPageOptions`).
  - `requestTranslation` → `collectOcrBboxHints` → `readConfiguredOcrResult` → `normalizeOcrBboxResultPayload` → `normalizeOcrBboxHintPayload` 순서로 흐른다.
  - 이 과정에서 `sanitizeOcrTextForPrompt`가 **번역 요청의 option(glossary omission term, workContext)으로 다시 적용된다**(`runtime/ocr/bbox-results.cjs`, `hint-normalization.cjs`).
- **[FACT]** hint가 review metadata(`B####`)를 갖지 않으므로 JS adjacency grouper(`attachOcrGroupingHints`)도 적용된다. 결과는 `.slice(0, 80)`으로 자른다.
- **[FACT]** `Previous pass blocks`의 `jp`는 저장된 `sourceText`를 `sanitizePromptLine(…, 160)` 등 별도 정규화로 넣는다.

**결론 [INFERENCE]**
- translation 입력 단계에서 이미 sanitize가 다시 수행된다. 따라서 OCR stage에서 raw OCR text를 보존하고 sanitize를 translation 입력 단계에만 두는 것은 prompt 품질을 거의 바꾸지 않고 가능해 보인다.
- 남는 차이는 두 가지다.
  1. OCR 단계 sanitize는 OCR 시점의 glossary를 쓰고 translation 단계는 번역 시점의 glossary를 쓴다.
  2. raw text가 160자를 넘으면 두 번째 sanitize도 160자에서 자르므로 prompt 길이는 같다.
- `assertWorkflowSource`의 빈 `sourceText` 판정과 erase/typography의 `sourceText` 사용(OCR 문서 §9)은 raw 보존 여부에 영향을 받는다.

### 3.5 Glossary / omission

**[FACT]**
- `collectGlossaryOmissionTerms(styleGuide)` 결과는 두 곳에 쓰인다.
  - OCR hint text에서 제거(`sanitizeOcrTextForPrompt`)
  - 결과 item에서 제거(`applyGlossaryOmissionsToOverlayItems`)
- glossary/characters는 `enabled !== false`이고 target이 있는 항목만 prompt에 들어간다.

### 3.6 모델 출력에서 glossary로의 feedback loop

**[FACT]**
- `collectPageContext`(= `plan.cumulative`)면 모델이 `<page-context>` JSON을 출력한다.
- `persistPageContextAfterSuccess` (`pipeline/pageContextPersistence.ts:51`)가 이를 chapter `story-memory.json`과 work `style-guide.json`(glossary/characters)에 **자동 병합해 저장**한다.
- 저장 실패는 warning으로만 남는다.

**[FACT]** local style guide 5개의 glossary 49개가 전부 `origin:"ai"`이고 수동 항목은 0개다. characters는 33개다.

**[INFERENCE]** 모델 출력이 다음 page prompt의 "stronger than story memory" glossary로 다시 들어간다. 오역이 자기 강화될 수 있는 구조다. 일부 항목은 일반 명사로 보인다. 품질 판단은 이 문서 범위 밖이다.

## 4. Translation Input Contract

### REQUIRED — 현재 source가 실제로 사용하는 최소 입력 [FACT]

| 입력 | 사용처 |
|---|---|
| page image path(원본)와 width/height | image variant, 좌표 보정 section, bbox 정규화 |
| 대상 block 목록(순서 포함) | candidate id = index+1 |
| block `id` | 결과 merge key (`mergeWorkflowTranslations`) |
| block `bbox` + `bboxSpace` | candidate 좌표, overlap fallback |
| block `sourceText` | candidate `ocrText`, previous `jp`, 빈 원문 guard |
| source/target language | prompt profile, sanitize 규칙 |
| model endpoint와 sampling/maxTokens | request body |

### OPTIONAL / QUALITY CONTEXT [FACT]

- 기존 `translatedText` (previous `ko`)
- block `confidence`, `textRole`
- work style guide(glossary, characters, rules)
- glossary omission term
- chapter story memory(최근 6 page)와 이전 chapter story pages(`plan.cumulative`)
- page-context 수집 여부
- enhanced image variant (retry 시)

### CARROT-SPECIFIC

- `TranslationOptions` 전체 option bag(OCR/서버/UI progress 필드 혼재)
- `workflowOrigin`, receipt, `pageRevision`
- `soundEffectReview`, `effectReviewRegions`
- font matching / typography field
- image redaction review
- run path/artifact 저장
- progress event와 i18n 문구

**[INFERENCE]**
- translation layer에 `MangaPage` 전체나 `ChapterSnapshot`이 필요하지 않다.
- 실제로 필요한 것은 `{ pageImage, pageSize, blocks:[{id, bbox, sourceText, previousTranslation?, role?}], languages, context? }` 수준이다.
- Carrot도 translate 직전에 대상 block만 담은 page 사본을 만든다.

## 5. Translation Output Contract

### 5.1 요구 형식

**[FACT]**
- JSON이 아닌 **plain text record**를 요구한다. record 사이는 빈 줄이다.
- key는 `id, type, textRole, x1, y1, x2, y2, direction, angle, fontSize, confidence, jp, ko`다(`OVERLAY_OUTPUT_SCHEMA`).
- `collectPageContext`면 마지막에 `<page-context>{JSON}</page-context>`를 붙인다.
- local 출력 sample도 이 형식이었다.

### 5.2 Parse와 validate 순서 [FACT]

1. `extractPageContextResponse`로 trailer를 분리한다.
2. `parseJsonLenient` (`runtime/parsing/overlay-json-recovery.cjs:43`)
   - special token 제거 → JSON 후보 추출(실패하면 loose record parser)
   - 원문, trailing comma 제거, `repairBrokenJson` 순으로 `JSON.parse`를 시도한다.
   - 모두 실패하면 loose parser를 다시 시도하고, 그래도 실패하면 예외를 던진다.
   - **[INFERENCE]** 현재 plain text 출력은 loose record parser가 처리하는 경로가 기본이다.
3. `normalizeItems` → `normalizeItem` (`runtime/parsing/overlay-items.cjs:76`)
   - `ko`가 없거나 bbox가 없으면 record를 **조용히 버린다**.
   - placeholder(`[?]`)만 있는 쌍도 버린다.
   - `id`가 없으면 `index + 1`을 부여한다(`buildNormalizedItem`, `:119`).
   - `candidateIds`는 중복이나 비정수가 하나라도 있으면 무시한다.
4. `applyGlossaryOmissionsToOverlayItems`
5. `validateOverlayItemsAgainstReferences` (`pipeline/overlayItemReferences.ts:41`)의 drop 사유:
   - `fragment_noise`, `merged_ui_list`
   - `duplicate_id`: 먼저 나온 record를 유지한다.
   - `new_id_overlaps_ocr_candidate`: 단, 큰 block이 후보 하나와 강하게 겹치면 **그 후보 id로 재매핑**한다.
   - `duplicate_physical_text`
6. `filterRejectedOrUncertainSoundItems`: `textRole:"sound"`이고 confidence < 1이면 제거한다.
7. item이 0개일 때:
   - OCR no-text 요청이었으면 no-text page로 처리한다.
   - 아니면 `bbox 결과를 만들지 못했습니다` 예외를 던지고 page retry로 간다(`buildEmptyItemsResult`, `:498`).

### 5.3 경우별 처리

| 경우 | 처리 | 근거 |
|---|---|---|
| malformed 출력 | lenient/loose parse 후 실패하면 예외 → page retry | [FACT] |
| missing block | 해당 block은 이전 `translatedText` 유지. page는 `completed` | [FACT] `mergeWorkflowTranslations`는 non-empty 결과만 반영 |
| duplicate id | 첫 record 채택, 나머지 drop | [FACT] |
| 재정렬된 record | id 기반 매핑이라 순서와 무관 | [FACT] |
| 빈 번역 | `ko`가 비면 record drop → missing block과 같음 | [FACT] |
| 추가 unexpected record | 새 id가 candidate와 겹치면 drop 또는 재매핑. 안 겹치면 validation 통과 후 overlap(≥0.3) fallback으로 **빈 block에 배정될 수 있음** | [FACT] §7 |
| truncated 출력 (max_tokens) | 끝까지 parse된 record만 채택하고 나머지는 missing | [INFERENCE] finish_reason을 검사하는 코드는 찾지 못했다 |
| 반복/degenerate 번역 | 검사 없음 | [FACT/local] 설치 앱 chapter의 한 block에 2,813자 반복 번역이 `finish:stop`, completion 3,700 tokens로 수용됐다 |
| model `jp`, geometry, direction, fontSize | staged merge에서 사용하지 않음. `translatedText`, `fontRole`, `fontRoleConfidence`, `visualClusterId`만 반영 | [FACT] `mergeWorkflowTranslations` |

## 6. Retry / Failure / Recovery

- **Page 단위 retry [FACT]**
  - `maxAttempts = MANGA_TRANSLATOR_PAGE_RETRIES`(기본 5)다(`pipeline/endpointSession.ts:82`).
  - 매 attempt마다 같은 option으로 요청을 다시 만든다. 이미지, prompt, context 모두 같다.
  - 예외: 직전 실패가 `empty-overlay-items`면 `includeEnhancedVariant=true`, `enhancedContrast ≥ 1.6` 이미지를 추가한다(`translatePageWithRetries.ts` `applyEnhancedRetryVariant`).
- **Failure 분류 [FACT]** `pipeline/failure.ts`의 message 규칙: `image-preprocessing`, `server-startup`, `model-request`, `response-json-parse`, `overlay-parse`, `empty-model-response`, `empty-overlay-items`, `runtime`, `unknown`
  - abort와 non-retriable runtime error는 retry 없이 즉시 전파한다.
- **Retry 소진 [FACT]** `saveFailedPage` → `buildFailedPage`(`analysisStatus:"failed"`) → `translateWorkflowPage`가 예외를 던진다. 그러면 `executeWorkflowPage`가 receipt 실패를 저장하고 page issue를 기록한다. 이후 stage는 그 page를 건너뛴다(`hasFailedDependency`).
- **HTTP [FACT]**
  - 요청 deadline은 30분이다(`MODEL_HTTP_REQUEST_DEADLINE_MS`, `transport/network-budgets.cjs`).
  - API key retry(`runWithApiKeyRetry`, 설정 `keyMaxAttempts`)가 있다.
- **OCR 실패 gate [FACT]** hint에 `ocrHealth.failed`가 있으면 번역 요청 전에 page를 실패시킨다(`assertNoFailedHayaiOcr`). staged workflow에서는 OCR stage가 이미 막는다.
- **Silent fallback [FACT]**
  1. 누락되거나 drop된 block은 이전 값(첫 실행이면 빈 문자열)을 유지한 채 page가 `completed`가 된다.
     - local: completed page에서 `sourceText`는 있지만 `translatedText`가 빈 block이 87개(chapter별 3, 8, 68, 8)다.
  2. page-context 누락이나 invalid, 저장 실패는 warning만 남긴다.
  3. enhanced variant 생성이 실패하면 원본만으로 계속한다(stderr warning).
  4. `ko`/bbox가 없는 record는 조용히 drop된다.
- **Local retry 흔적 [FACT]** 두 page에 attempt-2가 있다. attempt-1 디렉터리에는 `result.json`이 없다(응답 저장 전에 실패). 원인 로그는 회전되어 **[UNKNOWN]**이다.
- **User review 요구 [FACT]** translation 경로 자체는 사용자 review를 강제하지 않는다. OCR CHECK 실패만 사용자 입력을 요구한다.

## 7. Ordering and Block Identity

### 7.1 Identity 연결 경로

1. **Detection**: `block.id = region.id`, `blockOrder`를 생성한다 [FACT].
2. **OCR**: manifest `id = index+1`(대상 block 순서)로 결과를 `block.id`에 binding한다. revision과 stage key로 guard한다(OCR 문서) [FACT].
3. **Translation**: 대상 block 배열에서 candidate `id = index+1`을 부여한다(`buildKeepBlocksOcrResult`). `previousBlocksForPrompt[i] = {previousId: block.id, candidateId: i+1}`이다(`assignSequentialCandidateIds`, `previousBlocksForPrompt.ts`) [FACT].
4. **결과 매핑**: `assignItemsToExistingBlocks` (`keepBlocksAssignment.ts:42`) [FACT]
   - `item.id` → `candidateId` → block index 순으로 찾고, 먼저 나온 item이 이긴다.
   - 매칭되지 않은 item은 아직 배정되지 않은 block 중 bbox overlap(≥0.3)이 가장 큰 block에 배정한다.
5. **Merge**: `mergeWorkflowTranslations`는 `block.id`로 결과를 반영한다 [FACT].

### 7.2 위험 지점

- **Array index 의존 [FACT]**: candidate id는 요청 시점의 대상 배열 순서에서 나온다. 한 요청 안에서는 일관된다.
- **Stale guard [FACT]**
  - translation에는 OCR 같은 `pageRevision`/stage-key 비교가 없다.
  - 대신 page를 workflow 시작 시 acquire(lock)하고, stage 완료 receipt(`workflowStageComplete`, `configurationKeys`)로 재실행 여부를 판정한다.
  - 저장은 `port.save(chapterId, before, …)`로 한다.
  - **[INFERENCE]** 요청 중 동시 편집은 lock으로 막는 구조다. `save`의 `before` 비교 semantics는 확인하지 않았다 [UNKNOWN].
- **[INFERENCE] 잘못 배정될 수 있는 경우**
  - 모델이 id를 틀리거나 빠뜨리면 parser가 `index+1`을 부여한다.
  - overlap fallback이 인접 말풍선의 빈 slot에 번역을 채울 수 있다.
  - 실제 발생 빈도는 [UNKNOWN]이다.
- **80개 상한 [FACT]**: `previousBlocksForPrompt`는 `slice(0, 80)`, hint 정규화도 80개 상한이다. **[INFERENCE]** 한 page에 81개 이상의 대상 block이 있으면 초과분은 번역되지 않고 missing으로 남는다. local 최대는 page당 20 blocks다.

### 7.3 Rover가 유지해야 할 identity invariant [RECOMMENDATION — USER DECISION REQUIRED]

1. block의 영속 id를 요청 payload에 직접 넣고 결과 key로 쓴다. 요청마다 새로 붙는 index id는 전송 형식에만 쓴다.
2. 결과 매핑은 id 일치만 허용한다. overlap fallback과 index 기본 id는 제거하거나 명시적 경고로 바꾼다.
3. 누락 block은 "번역 없음" 상태로 명시한다. page 완료 여부와 분리해서 기록한다.
4. 결과 적용 전에 대상 block의 `sourceText`/bbox revision이 요청 시점과 같은지 확인한다.

## 8. Context and Batching

- **[FACT] 실행 단위**
  - 요청 1개 = page 1개(대상 block 전부 포함).
  - staged workflow는 `runWholePagePipeline`을 page마다 호출한다(`pages:[input]`).
  - chapter 안의 page들은 순차 처리된다.
  - 여러 page를 한 요청으로 묶는 batch는 없다.
- **[FACT] Context 구성**
  - 같은 page: 모든 대상 block, 전체 이미지, 이전 번역.
  - page 간: story memory(최근 6 page, 예산 pruning), glossary/characters, 이전 chapter story pages.
- **[FACT] Token 규모**: local prompt tokens median 약 7.3–7.6k, max 8.8k(이미지 포함). `maxTokens=8192`.
- **[FACT] Failure isolation**: page 단위다. 한 page가 실패하면 그 page의 후속 stage만 막힌다.
- **[INFERENCE]** page 순서가 story memory에 영향을 주므로 번역 결과는 처리 순서에 의존한다. page 간 병렬화는 이 context 흐름을 바꾼다.

## 9. Runtime Lifecycle

### 9.1 OCR에서 translation으로의 handoff [FACT]

`TranslationRuntimePort.startEndpointSession` (`translationRuntimePort.ts`) 순서:

1. `runtime.simplePage.waitForOcrIdle()`: OCR child process가 완전히 종료될 때까지 대기
2. `hayaiRegionPrepass.releaseDetectorResources("translation-model-start")`: Koharu detector 해제
3. `groupingEvidence.releaseIdleResources(…)`
4. `releaseInpaintingBeforeGemma`: **`modelProvider === "gemma"`일 때만** 캐시된 inpainting engine 해제
5. `startModelEndpointSession`

OCR stage는 stage-major이므로 모든 page의 OCR이 끝난 뒤 translate stage가 시작된다.

### 9.2 Endpoint session 수명 [FACT]

- session은 `preparePagesWithinEndpointSession`의 `try/finally`에서 `runWholePagePipeline` 한 번 동안만 유지되고 `dispose`된다.
- 종료 동작은 provider마다 다르다.
  - `openai-api`: process가 없다. `stopOpenAICompatibleApiEndpoint`는 Ollama local model release만 시도한다.
  - `gemma`: `stopServer`가 script가 띄운 child를 종료한다(Windows는 tree kill, 그 외 SIGTERM, 5초 뒤 강제 종료).
  - 재사용은 `options.reuseServer`가 켜져 있고 기존 server에 도달할 수 있을 때만 한다(`canReuseServer`).
- **[INFERENCE]** staged workflow는 page마다 `runWholePagePipeline`을 부르므로, `gemma` provider에서는 page마다 llama-server spawn → model load → 종료가 반복될 수 있다.
  - script가 띄운 server는 dispose 때 종료되므로 다음 page에서 reuse 조건도 성립하지 않는다.
  - 실제 동작과 비용은 [UNKNOWN]이다(실행 검증 필요).
  - `openai-api`에서는 이 비용이 없다. local evidence의 `cached_tokens`가 높은 것은 원격 server가 prompt cache를 유지함을 보여준다.
- **[FACT]** 동시성: translation 요청은 page 순차다. 병렬 가속은 local erase와 겹치는 것뿐이다.
- **[FACT]** crash recovery: 요청 실패는 page retry로 처리한다. server 시작 실패는 `server-startup`으로 분류되고, 시작 시 VRAM throttle 오류를 정규화한다(`normalizeVramThrottleError`).

## 10. Portable Core vs Carrot Integration

| 분류 | Component | 근거 |
|---|---|---|
| **PORTABLE** | Prompt 조립: `runtime/prompts/*.cjs`(약 2.7k lines), `simple-page-prompts.cjs` | [FACT] Electron import 없음, Node 표준만 사용 |
| PORTABLE | Record parser: `runtime/parsing/*.cjs`(약 1.1k lines) | [FACT] |
| PORTABLE | 결과 validation과 매핑: `overlayItemReferences.ts`, `keepBlocksAssignment.ts`, `previousBlocksForPrompt.ts`, `overlayItems.ts`의 SFX filter | [FACT] shared geometry에만 의존 |
| PORTABLE | Chat request body와 message 조립: `request-bodies.cjs`, `simple-page-request-builders.cjs`의 `buildMessages`, `chat-completion.cjs` | [FACT] `fetch` 기반 |
| **ADAPTABLE** | Retry loop (`translatePageWithRetries.ts`), failure 분류 | [INFERENCE] 개념은 단순하지만 progress, warning collector, run artifact에 결합돼 있다 |
| ADAPTABLE | Work context 구성과 pruning (`buildPromptWorkContextForPage`, `prunePromptWorkContextForBudget`), page-context persistence | [INFERENCE] library facade 대신 파일 port가 필요 |
| ADAPTABLE | Image variant: 원본 파일을 data URL로 변환 | [FACT] 크기 확인용 Electron `nativeImage` fallback과 webp용 FFmpeg는 교체 대상 |
| ADAPTABLE | `openai-api` endpoint | [FACT] 객체 생성뿐이라 그대로 작은 client로 대체 가능 |
| **REPLACE** | `wholePagePipeline.ts`(1,020 lines)의 checkpoint, codex 위임, font matching, redaction review, region context | [FACT] staged translate에 불필요한 분기 다수 |
| REPLACE | Managed llama runtime catalog, 다운로드, preflight, MTP calibration, Windows DLL | [FACT] Linux 항목 없음 |
| REPLACE | `runtimeModuleLoader`/`appPaths`(Electron `app`), progress/i18n, library lock/receipt/IPC | [FACT] |
| REPLACE | image redaction (`imageRedactionContext.ts`, `nativeImage`) | [FACT] Carrot 기능 |

## 11. Linux / RoverCMT Runtime Boundary

[RECOMMENDATION — USER DECISION REQUIRED] 다음은 비교이며 architecture를 확정하지 않는다.

| 후보 | 구조 | 장점 | 단점 / 검증 필요 |
|---|---|---|---|
| A. OpenAI 호환 HTTP client만 | Rover Core → Translation Adapter → (외부) OpenAI-compatible `/v1/chat/completions` | 현재 local evidence와 같은 구조. process 관리 없음. Carrot runtime manager 불필요 | server 기동과 model 배치는 Rover 밖의 책임. vision 지원 server(mmproj)가 필수 |
| B. A + 최소 llama-server launcher | Rover가 `llama-server` binary 경로, model/mmproj 경로, port를 받아 spawn/readiness/stop | 단일 machine 자동화 | Linux binary, flag, GPU 설정 검증 필요. session을 chapter 단위로 유지해야 page별 reload를 피함 |
| C. Carrot runtime manager 이식 | catalog, 다운로드, preflight, MTP, VRAM policy | 기능 동등 | Windows/macOS 전용 catalog, 큰 코드와 상태. Rover 원칙(단순성)에 반함 |

**[INFERENCE]**
- 현재 사용자 운영은 이미 A 구조다(`openai-api` 100%).
- 따라서 Rover 초기에는 prompt/parser/validation/매핑 + 작은 HTTP client면 production 경로를 재현할 수 있다.
- Carrot runtime manager 전체 이식은 필요하지 않다.
- 단, translation은 **vision 요청**이다. 텍스트 전용 LLM endpoint로는 현재 prompt contract를 만족하지 못한다.

## 12. Existing Tests

`tests/`에서 이름 기준으로 translation 관련 파일 179개를 찾았다. 주요 파일은 아래와 같다.

| 분류 | 예시 파일 | 추론 방식 |
|---|---|---|
| Prompt contract | `promptContract.test.ts`(15 cases), `promptWorkContext.test.ts`, `runtimePromptMessages.test.ts`, `cumulativePrompt.test.ts`, `glossaryOmission.test.ts` | mock / 순수 함수 [FACT] |
| Parser / normalization | `overlayParser.test.ts`(23), `overlayItems.test.ts`, `overlayCandidateIdPosition.test.ts`, `pageContextResponse.test.ts` | 순수 함수 [FACT] |
| Validation / 매핑 | `overlayItemReferences.test.ts`(10), `keepBlocksResult.test.ts`(32), `pageWorkflowAdapters.test.ts`(`translateWorkflowPage` 포함) | harness와 가짜 결과 [FACT] |
| Retry / failure / lifecycle | `translationPageFailureContinuation.test.ts`, `endpointSessionLifecycle.test.ts`(6), `translationRuntimePort.test.ts`, `wholePagePipeline.test.ts`(22), `translationImmediateCancellation.test.ts` | runtime mock [FACT] |
| Transport | `runtimeChatCompletion.test.ts`(6), `runtimeApiKeyRetry.test.ts` | fetch stub [FACT] |
| Local runtime | `llamaServerOutput*.test.ts`, `runtimeLaunchArgs*.test.ts`, `llamaRuntime*.test.ts`, `gemma4OfficialChatTemplate.test.ts`(일부 `runIf win32`) | 실제 model 추론 없음 [FACT] |
| Fixed-block / semantic OCR | `fixedBlock*.test.ts`, `hayaiFixedBlockTranslation.test.ts`, `semanticOcr*.test.ts` | mock. staged production path 아님 |
| Context memory | `pageContextPersistence.test.ts`, `storyMemory*.test.ts`, `workContext*.test.ts` | mock |

- **[FACT]** vitest suite에서 실제 LLM 추론을 수행하는 테스트는 찾지 못했다.
  - `gemmaCleanupAudit.test.ts`는 frozen asset이 없으면 skip한다.
  - 실제 추론은 Electron이 필요한 수동 script(`scripts/smoke-overlay.cjs`)와 benchmark(`scripts/gemma-benchmark/`, `run-gemma-economy-benchmark.cjs`)뿐이다.
- **[INFERENCE] Rover 재사용 가능 contract test**: prompt contract, parser, reference validation, keep-block 매핑 테스트는 순수 함수 대상이라 fixture로 옮겨 쓸 수 있다.
- **[INFERENCE] 새로 필요한 test**
  - 실제 endpoint 대상 smoke(§15)
  - 누락 block을 명시적으로 표시하는지
  - degenerate/반복 출력 탐지(도입 시)
  - id-only 매핑 invariant
  - finish_reason=length 처리

## 13. Real Library / Runtime Evidence (요약)

**[FACT]** 조사 시점 기준:

| Chapter (prefix) | Data root | Blocks | 번역 있음 | 원문 있음·번역 없음 (completed) | OCR 실패 page |
|---|---|---:|---:|---:|---:|
| `592a103c` | repo | 204 | 200 | 3 | 1 |
| `af091799` | repo | 42 | 42 | 0 | 0 |
| `408fb247` | repo | 178 | 170 | 8 | 1 |
| `46e79bc1` | 설치 앱 | 179 | 171 | 8 | 0 |
| `b909e2ad` | 설치 앱 (조사 중 생성) | 627 | 559 | 68 | 0 |

- run artifact 207건의 backend/model/token 통계는 §2.1에 있다.
- style guide glossary 49개(전부 `ai`), characters 33개, story memory는 chapter별로 존재한다.
- 한 page의 degenerate 반복 번역이 `finish:stop`으로 수용됐다(§5.3).

## 14. Unknowns

1. Linux에서 llama.cpp server와 Gemma 4 26B GGUF + mmproj(vision) 조합이 Rover가 원하는 flag로 정상 동작하는지
2. 현재 원격 server의 binary/version/flag/GPU와 context 설정(요청 `max_tokens=8192`, settings `ctx` 값과의 관계)
3. RTX 5090 등 특정 GPU에서의 VRAM 사용량, tokens/sec, 이미지 token 비용(local 로그의 126 tok/s는 원격 server 보고값)
4. GGUF quantization별 품질/속도, Windows와 Linux 결과 차이
5. `openai-api`에서 strict refine sampling 제한이 실제 전송 body에 반영되는지(§3.3)
6. local `gemma` provider에서 page마다 server를 재시작하는지와 그 비용(§9.2)
7. attempt-1이 실패한 두 page의 실패 원인(로그 회전)
8. 모델 id 오류와 overlap fallback 오배정의 실제 빈도
9. `port.save(…, before, …)`의 충돌 검사 semantics
10. 자동 누적 glossary가 번역 품질에 미치는 영향
11. 모델 출력 품질(번역 정확도) 자체

## 15. Runtime Smoke Test Plan (미실행)

| 단계 | 내용 | 성공 기준 |
|---|---|---|
| S0 environment | Linux distro, driver/CUDA, GPU/VRAM, llama.cpp build/version, model·mmproj 파일 hash 기록 | 기록 완료 |
| S1 runtime start | `llama-server`를 model+mmproj, 지정 port로 시작 | `/health` 또는 `/v1/models` 응답, 시작 시간 기록 |
| S2 model load | 첫 load 시간, VRAM 사용량 | 로그에서 vision projector load 확인, OOM 없음 |
| S3 single request | 텍스트 1개 + 작은 이미지 1개의 chat completion | 200 응답, `choices[0].message.content` 존재, `usage` 기록 |
| S4 production prompt | 기존 run의 `result.json`에 저장된 system/user prompt와 **같은 page 원본 이미지**로 동일 body 재전송(Carrot 코드 없이 저장 prompt 사용) | plain text record 형식 준수. Carrot parser 사본으로 parse 성공. candidate id 집합 일치. 저장된 `outputText`와 차이를 기록(판정 아님) |
| S5 malformed / retry | 잘린 출력(`max_tokens` 소량), 잘못된 id, 빈 `ko`를 가진 합성 출력을 parser와 매핑에 입력 | 현재 동작(drop/missing/index id) 재현을 기록. Rover 정책 결정 입력 |
| S6 multi-page | 같은 chapter 5–10 page를 page 순서대로 요청하고 story memory 없이/있이 비교 | 모든 page parse 성공률, block 누락 수 |
| S7 timing / memory | S6에서 page당 wall time, prompt/completion tokens, tokens/sec, peak VRAM | 수치 기록 |
| S8 shutdown / restart | server 종료 후 재시작, 연속 요청, 요청 중 abort | 재시작 시간, 좀비 process 없음, abort 후 다음 요청 정상 |

입력으로 쓰는 run artifact와 이미지는 읽기만 하고, smoke 산출물은 Rover spike 디렉터리에만 둔다.

## 16. Recommended Migration Boundary

**[RECOMMENDATION — USER DECISION REQUIRED]**

### 그대로 가져갈 것

- prompt section 조립(`runtime/prompts`)과 overlay output 형식(현재 품질을 만든 contract)
- record parser(`runtime/parsing`)
- reference validation(duplicate/fragment/SFX filter)
- chat message 조립(이미지 data URL + system/user)

### Adapter로 만들 것

- **Translation adapter 입력**: `{pageImagePath, pageSize, blocks:[{id, bbox, sourceText, previousTranslation?}], languages, context?}`
- **Translation adapter 출력**: `{blockId → translatedText | missing}` + raw 응답 artifact
- 작은 OpenAI 호환 HTTP client(timeout, abort, 소수 retry)
- 파일 기반 glossary/story memory port(선택 기능)
- image 로딩: Node 파일 읽기 + 크기 정보는 입력으로 받는다(Electron `nativeImage` 제거)

### 버릴 것 (초기)

- managed llama runtime catalog/다운로드/preflight/MTP
- Codex provider, fixed-block/group-review 경로, region crop, sound-effect translation
- image redaction, checkpoint 재사용, font matching 연계, progress/i18n, library lock/receipt/IPC

### 아직 결정하지 않을 것

1. page-context trailer와 AI glossary 자동 누적을 유지할지(품질과 자기 강화 위험 사이의 trade-off)
2. 누락 block 처리 정책: 재요청할지, 누락 표시만 할지. 현재 Carrot은 조용히 completed로 둔다.
3. degenerate 출력 탐지 도입 여부
4. overlap fallback과 index 기본 id를 제거할지
5. raw OCR 보존과 sanitize 위치(§3.4: 기술적으로 가능해 보임)
6. local llama-server launcher(B) 포함 여부와 session 범위(chapter 단위 권장 여부)
7. Rover에서 모델 출력 geometry(`x1..`, `fontSize`, `direction`)를 쓸지. 현재 staged merge는 쓰지 않는다

## 17. Exact Next Step

§15의 **S4를 단독으로** 수행한다.

1. 기존 run artifact 한 건의 `result.json`에서 system/user prompt, request 설정과 해당 page 원본 이미지를 읽는다.
2. Carrot 코드나 renderer 파일을 건드리지 않는 작은 Rover spike script로 현재와 같은 OpenAI 호환 endpoint에 동일 body를 보낸다.
3. 응답을 Carrot parser 사본(`runtime/parsing`)으로 parse해 다음을 기록한다.
   - candidate id 일치
   - 누락 block 수
   - 저장된 `outputText`와의 차이

이 작업은 새 runtime 설치 없이 기존 endpoint로 수행할 수 있고 renderer 작업과 파일이 겹치지 않는다. Linux runtime 검증(S0–S2)은 그 다음 단계다.
