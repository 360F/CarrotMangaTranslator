import { basename } from 'node:path';
import { buildMessages } from './ported/messages.mjs';
import { getOverlayPrompt, buildSystemPrompt, resolvePromptCoordinateFrame } from './ported/runtime/simple-page-prompts.mjs';
import { buildKeepBlocksOcrResult } from './ported/keepBlocksOcr.mjs';
import { buildPreviousBlocksForPrompt } from './ported/previousBlocksForPrompt.mjs';
import { buildPromptWorkContextForPage } from './ported/workContextPrompt.mjs';
import { prunePromptWorkContextForBudget } from './ported/workContextBudget.mjs';
import { collectGlossaryOmissionTerms } from './ported/glossaryOmissionShared.mjs';
import { readBoundedResponseText } from './ported/runtime/transport/bounded-response-body.mjs';
import { extractModelOutputText, extractModelOutputFailure } from './ported/runtime/transport/response-text.mjs';
import { applyLocalForbiddenTokenBias } from './ported/runtime/simple-page-logit-bias.mjs';

export function pageOptions(page, context, config, index, attempt) {
  const ocrBboxResult = buildKeepBlocksOcrResult(page, page.blocks.map(b => b.sourceText));
  const work = buildPromptWorkContextForPage({ baseStyleGuide: context.styleGuide, storyMemory: context.storyMemory,
    pageId: page.id, pageIndex: index, recentPageCount: 6, previousStoryPages: context.previousStoryPages ?? [], ocrHints: ocrBboxResult.hints });
  const pruned = prunePromptWorkContextForBudget(work, { ctx: 65536, maxTokens: 32768 });
  return { modelProvider: 'gemma', modelSource: 'local', localModelPath: config.modelPath, localMmprojPath: config.mmprojPath,
    sourceLanguage: config.sourceLanguage ?? 'ja', targetLanguage: config.targetLanguage ?? 'ko',
    promptMode: 'overlay_bbox_lines_multiview', ocrPipeline: 'hayai',
    imagePath: page.imagePath, imageWidth: page.width, imageHeight: page.height, ctx: 65536, maxTokens: 32768,
    port: config.port ?? 18180, batch: 1024, ubatch: 1024, fitTargetMb: 1024, fitEnabled: true,
    cacheTypeK: 'q4_0', cacheTypeV: 'q4_0', ctxCheckpoints: 0, kvOffload: true, mmprojOffload: true,
    imageMinTokens: 1024, imageMaxTokens: 1024,
    temperature: 0.1, topP: 0.85, topK: 32, gemmaReasoningBudget: 0, gemmaVramMode: 'economy26b',
    strictRefineMode: true, keepBlocksMode: true, aiFontSizeMatching: false, autoFontMatching: false, naturalTextLayout: false,
    imageFirst: true, includeEnhancedVariant: false, enhancedMaxLongSide: 1900, enhancedContrast: 1.35,
    ocrBboxResult, ocrBboxHints: ocrBboxResult.hints, ocrTextEvidenceCount: ocrBboxResult.textEvidenceCount,
    ocrTranscriptEvidenceCount: ocrBboxResult.hints.filter(h => /[\p{L}\p{N}]/u.test(h.ocrText ?? '')).length,
    previousBlocksForPrompt: buildPreviousBlocksForPrompt(page, ocrBboxResult.hints, { assignSequentialCandidateIds: true }),
    workContext: pruned.workContext, workContextBudget: pruned.budget,
    glossaryOmissionTerms: collectGlossaryOmissionTerms(context.styleGuide),
    collectPageContext: config.cumulative !== false, cumulativeContextDetail: config.cumulativeDetail ?? 'detailed',
    pageIndex: index, translationAttempt: attempt };
}
export function buildRequest(options, variants) {
  const promptText = getOverlayPrompt(options, variants), systemPrompt = buildSystemPrompt(options);
  const messages = buildMessages(options, variants, promptText, systemPrompt);
  const body = { model: basename(options.localModelPath), temperature: options.temperature, top_p: options.topP, top_k: options.topK,
    presence_penalty: 0, frequency_penalty: 0, max_tokens: options.maxTokens, reasoning_budget: 0, enable_thinking: false,
    chat_template_kwargs: { enable_thinking: false }, messages };
  const frame = resolvePromptCoordinateFrame(options, variants);
  return { body, promptText, systemPrompt, frame };
}
export async function requestPage(server, options, variants, signal) {
  const abortSignal = AbortSignal.any([AbortSignal.timeout(1800000), ...(signal ? [signal] : [])]);
  const bounded = { ...options, abortSignal };
  const request = buildRequest(bounded, variants);
  const tokenBias = await applyLocalForbiddenTokenBias(server, bounded, request.body);
  const response = await fetch(`${server.baseUrl}/chat/completions`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-llama-server' },
    body: JSON.stringify(request.body), signal: abortSignal });
  const text = await readBoundedResponseText(response, { label: 'Gemma response', maximumBytes: 16 * 1024 * 1024, signal: abortSignal });
  if (!response.ok) {
    const error = new Error(`Gemma request failed: ${response.status} ${text.slice(0, 4000)}`);
    // model-http-errors.cjs: credential errors remain retryable; 429/5xx retry.
    Object.assign(error, { status: response.status, nonRetriable: response.status >= 400 && response.status < 500 && ![402, 408, 409, 425, 429].includes(response.status) && !(response.status === 400 && /API_KEY_INVALID|Please pass a valid API key|API key (?:is not valid|expired|has been reported as leaked)/i.test(text)), failureCategory: 'model-request' });
    throw error;
  }
  let rawResponse;
  try { rawResponse = JSON.parse(text); } catch (cause) { throw new Error('Gemma response JSON parse failed.', { cause }); }
  const outputText = extractModelOutputText(rawResponse);
  const failure = extractModelOutputFailure(rawResponse);
  if (failure) throw Object.assign(new Error(failure.message), failure);
  if (!outputText.trim()) throw Object.assign(new Error('Gemma empty response'), { failureCategory: 'empty-model-response' });
  return { ...request, tokenBias, rawResponse, outputText };
}
