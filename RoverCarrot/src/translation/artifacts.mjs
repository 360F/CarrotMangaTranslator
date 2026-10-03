import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { summarizeOcrBboxHint, summarizeImageVariants } from './ported/artifact-summary.mjs';
import { truncateText } from './ported/runtime/prompts/model-profile.mjs';
// Managed projection of result-artifact-settings.cjs; no full workContext
// snapshot, image data URL, credentials or live process object is persisted.
export async function saveTranslationArtifacts(page, options, result, variants, server) {
  const keys = ['port', 'strictRefineMode', 'temperature', 'topP', 'topK', 'maxTokens',
    'ctx', 'batch', 'ubatch', 'gemmaVramMode', 'fitTargetMb', 'fitEnabled', 'cacheTypeK',
    'cacheTypeV', 'ctxCheckpoints', 'kvOffload', 'mmprojOffload', 'modelProvider',
    'modelSource', 'localModelPath', 'localMmprojPath', 'imageMinTokens', 'imageMaxTokens',
    'includeEnhancedVariant', 'enhancedMaxLongSide', 'enhancedContrast'];
  const settings = Object.fromEntries(keys.filter(k => options[k] !== undefined).map(k => [k, options[k]]));
  settings.previousBlocksForPromptCount = options.previousBlocksForPrompt.length;
  const requestSummary = { endpoint: `${server.baseUrl}/chat/completions`, model: result.body.model,
    label: page.name, promptMode: options.promptMode, strictRefineMode: true, keepBlocksMode: true,
    promptText: result.promptText, systemPromptText: result.systemPrompt,
    promptPreview: truncateText(result.promptText, 2400), systemPromptPreview: truncateText(result.systemPrompt, 2400),
    previousBlocksForPrompt: options.previousBlocksForPrompt.slice(0, 80),
    imageVariants: summarizeImageVariants(variants),
    bboxCoordinateSpace: result.frame.space, bboxCoordinateFrame: result.frame.frame,
    ocrPipeline: options.ocrPipeline, ocrBboxHintCount: options.ocrBboxHints.length,
    ocrBboxHints: options.ocrBboxHints.slice(0, 80).map(h => summarizeOcrBboxHint(h, true)),
    ocrBboxHintsPreview: options.ocrBboxHints.slice(0, 24).map(h => summarizeOcrBboxHint(h)), ocrTextEvidenceCount: options.ocrTextEvidenceCount,
    ocrTranscriptEvidenceCount: options.ocrTranscriptEvidenceCount,
    options: { ...settings, workContextBudget: options.workContextBudget }, localForbiddenTokenBias: result.tokenBias };
  const payload = { label: page.name, imagePath: page.imagePath, createdAt: new Date().toISOString(),
    settings, requestSummary, systemPrompt: result.systemPrompt, prompt: result.promptText,
    outputText: result.outputText, rawResponse: result.rawResponse };
  await writeFile(join(options.outputDir, 'result.json'), JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(options.outputDir, 'result.md'), result.outputText.trim() + '\n', { flag: 'wx' });
}
