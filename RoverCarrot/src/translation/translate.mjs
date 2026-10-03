import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveTranslationArtifacts } from './artifacts.mjs';
import { pageOptions, requestPage } from './request.mjs';
import { extractPageContextResponse } from './ported/pageContextResponse.mjs';
import { parseJsonLenient, normalizeItems } from './ported/runtime/overlay-parser.mjs';
import { normalizeOverlayItemBboxes, validateOverlayItemsAgainstReferences } from './ported/overlayItemReferences.mjs';
import { applyOcrCandidateGeometryLocks } from './ported/overlayOcrGeometryLocks.mjs';
import { filterRejectedOrUncertainSoundItems } from './ported/sound-filter.mjs';
import { assignItemsToExistingBlocks } from './ported/keepBlocksAssignment.mjs';
import { applyGlossaryOmissionsToOverlayItems } from './ported/glossaryOmission.mjs';
import { mergeCumulativePageContext } from './ported/cumulativePageContext.mjs';
import { upsertPageStoryMemory } from './ported/storyMemoryBuilder.mjs';
import { classifyFailure, isAbortErrorLike, isNonRetriableRuntimeError } from './ported/failure.mjs';

export function parseAndMerge(page, options, result) {
  const extracted = extractPageContextResponse(result.outputText);
  const rawItems = applyGlossaryOmissionsToOverlayItems(normalizeItems(parseJsonLenient(extracted.overlayText)), options);
  if (!rawItems.length) throw Object.assign(new Error(`${page.name}: bbox 결과를 만들지 못했습니다.`), { failureCategory: 'empty-overlay-items' });
  const normalized = normalizeOverlayItemBboxes(rawItems, page, result.frame.space === 'pixels'
    ? { coordinateSpace: 'pixels', pixelWidth: result.frame.frame.width, pixelHeight: result.frame.frame.height } : {});
  const locked = applyOcrCandidateGeometryLocks(normalized, page, options.ocrBboxHints);
  const validation = validateOverlayItemsAgainstReferences(locked, page, options.ocrBboxHints,
    options.previousBlocksForPrompt, { sourceLanguage: options.sourceLanguage });
  const accepted = filterRejectedOrUncertainSoundItems(validation.items);
  const assigned = assignItemsToExistingBlocks({ items: accepted.items, page, previousBlocks: options.previousBlocksForPrompt });
  const projected = { ...page, analysisStatus: 'completed', blocks: page.blocks.map((block, i) => {
    const item = assigned.get(i)?.item;
    return item ? { ...block, sourceText: item.jp.trim(), translatedText: item.ko.trim(),
      ...(item.fontRole ? { fontRole: item.fontRole, fontRoleConfidence: item.fontRoleConfidence ?? 0 } : {}),
      ...(item.visualClusterId ? { visualClusterId: item.visualClusterId } : {}) } : block;
  }) };
  // pageWorkflowTranslation.mergeWorkflowTranslations preserves canonical OCR,
  // geometry, formatting, roles and all omitted slots. Only these fields cross.
  const merged = { ...page, analysisStatus: 'completed', lastError: undefined,
    blocks: page.blocks.map((block, i) => {
      const output = projected.blocks[i];
      return output.translatedText.trim() ? { ...block, translatedText: output.translatedText,
        fontRole: block.fontRole ?? output.fontRole, fontRoleConfidence: block.fontRoleConfidence ?? output.fontRoleConfidence,
        visualClusterId: block.visualClusterId ?? output.visualClusterId } : block;
    }) };
  const warnings = options.collectPageContext && extracted.status !== 'parsed' ? [extracted.status === 'missing'
    ? `${page.name}: 페이지 컨텍스트가 없어 번역 결과만 저장했습니다.`
    : `${page.name}: 페이지 컨텍스트 JSON을 읽지 못해 번역 결과만 저장했습니다.`] : [];
  return { page: merged, projected, pageContext: extracted.pageContext, warnings, rawItems, validation, accepted };
}
export async function translatePage(page, index, context, config, ports, signal) {
  signal?.throwIfAborted();
  if (page.blocks.some(b => !b.sourceText.trim() && !b.translatedText.trim()))
    throw new Error('원문이 비어 있는 블록이 있습니다. 원문을 확인한 뒤 이어서 실행하세요.');
  const targets = page.blocks.filter(b => b.sourceText.trim() && !b.translatedText.trim());
  if (!targets.length) return { status: 'empty', page: { ...page, analysisStatus: 'completed' } };
  const input = { ...page, blocks: targets };
  const server = await ports.open(signal);
  let lastError, category;
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      signal?.throwIfAborted();
      const options = pageOptions(input, context, config, index, attempt);
      const outputDir = join(ports.artifactRoot, page.id, `attempt-${attempt}`);
      await mkdir(outputDir, { recursive: true });
      options.outputDir = outputDir;
      if (attempt > 1 && category === 'empty-overlay-items') {
        options.includeEnhancedVariant = true; options.enhancedContrast = 1.6;
      }
      try {
        const variants = await ports.images(input, options);
        const result = await requestPage(server, options, variants, signal);
        // Preserve the request/prompt/raw response before parsing (including failures).
        await saveTranslationArtifacts(input, options, result, variants, server);
        const parsed = parseAndMerge(input, options, result);
        await writeFile(join(outputDir, 'overlay-items.json'), JSON.stringify({ items: parsed.rawItems }, null, 2) + '\n', { flag: 'wx' });
        const updated = new Map(parsed.page.blocks.map(b => [b.id, b]));
        const mergedPage = { ...page, analysisStatus: 'completed', lastError: undefined, blocks: page.blocks.map(b => updated.get(b.id) ?? b) };
        const memory = mergeCumulativePageContext({ styleGuide: context.styleGuide,
          existingPageMemory: context.storyMemory.pages.find(p => p.pageId === page.id), page: parsed.projected,
          pageIndex: index, pageContext: config.cumulative === false ? undefined : parsed.pageContext,
          cumulativeContextDetail: config.cumulativeDetail ?? 'detailed', ocrResult: options.ocrBboxResult });
        for (const warning of [...parsed.warnings, ...memory.warnings]) ports.log?.('translation-warning', { pageId: page.id, warning });
        return { status: 'completed', page: mergedPage, pendingMemory: { styleGuide: memory.styleGuide,
          storyMemory: upsertPageStoryMemory(context.storyMemory, memory.pageMemory) } };
      } catch (error) {
        signal?.throwIfAborted();
        if (isAbortErrorLike(error) || isNonRetriableRuntimeError(error)) throw error;
        lastError = error; category = classifyFailure(error);
        await writeFile(join(outputDir, 'failure.json'), JSON.stringify({ attempt, category, message: String(error) }, null, 2) + '\n', { flag: 'wx' });
        ports.log?.('translation-retry', { pageId: page.id, attempt, category, message: String(error) });
      }
    }
    return { status: 'failed', page: { ...page, analysisStatus: 'failed', lastError: String(lastError) },
      message: String(lastError), retryable: true };
  } finally { await server.dispose(); }
}
