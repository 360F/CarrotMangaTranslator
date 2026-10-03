import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isGeneratedBubbleLayout } from '../typography/ported/shared/bubbleLayout.mjs';
import { processDetectedBubbleLayouts, resolveBubbleLayoutBlockRevision } from '../typography/ported/main/bubbleLayout/bubbleLayoutPageProcessor.mjs';
// Port of bubbleLayoutFacade: job-local detections, original-image inference,
// stat revision binding, required final pass and best-effort prepass behavior.
export function bubbleLayoutRunner(detect, log = () => {}) {
  const cache = new Map();
  return { async runPage(request) {
    let pageRevision = null;
    try {
      request.signal.throwIfAborted();
      const page = request.page;
      const [original, inpainted] = await Promise.all([stat(page.imagePath), stat(request.imagePath)]);
      pageRevision = createHash('sha256').update(`${page.imagePath}:${original.size}:${original.mtimeMs}:${request.imagePath}:${inpainted.size}:${inpainted.mtimeMs}`).digest('hex');
      let pending = cache.get(page.imagePath);
      if (!pending) { pending = detect(page); cache.set(page.imagePath, pending); }
      let detection;
      try { detection = await pending; } catch(error) { cache.delete(page.imagePath); throw error; }
      request.signal.throwIfAborted();
      return { patches: processDetectedBubbleLayouts({page, ...detection, pageRevision, policy: request.policy,
        paddingRatio: request.paddingRatio, sharedOwnershipGapPx: request.sharedOwnershipGapPx}),
        ...(request.includeTypographySegmentation ? {typographySegmentation: detection} : {}) };
    } catch (error) {
      if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      log('layout-failure', {pageId:request.page.id,failureMode:request.failureMode ?? 'required',message:String(error)});
      if (request.failureMode !== 'best-effort') throw error;
      return {patches:pageRevision ? request.page.blocks.filter(b => isGeneratedBubbleLayout(b.bubbleLayout) &&
        b.bubbleLayout.sourceImageRevision !== resolveBubbleLayoutBlockRevision(pageRevision,b)).map(b =>
        ({blockId:b.id,renderBbox:null,renderBboxSpace:null,bubbleLayout:null})) : []};
    }
  } };
}
