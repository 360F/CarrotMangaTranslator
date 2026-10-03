import type { Page, Stage, StageResult } from '../core/contracts.js';
import { hashStableValue } from '../detection/fingerprint.js';
import type { Hint } from './normalization.js';

export type PreparedOcr = { pageId: string; pageRevision: string; inputKey: string; targetBlockIds: string[];
  page: Page; manifest: Record<string, unknown> };
export type ReadOcr = (inputs: PreparedOcr[]) => Promise<Hint[][]>;
export function regionKey(page: Page, block: Record<string, unknown>): string {
  return hashStableValue([page.imagePath, page.width, page.height, block.bbox, block.bboxSpace]);
}
export function stageKey(page: Page): string {
  return hashStableValue([page.blocks.map(b => [b.id, regionKey(page, b)]), page.blocks.map(b => b.sourceText)]);
}
export function pageRevision(page: Page): string {
  const p = page as Page & Record<string, unknown>;
  return `page-v1:${hashStableValue({ id: p.id, imagePath: p.imagePath, inpaintedImagePath: p.inpaintedImagePath,
    inpaintMaskPath: p.inpaintMaskPath, maskProvenance: p.maskProvenance, width: p.width, height: p.height,
    blocks: p.blocks, blockOrder: p.blockOrder, translationCompletion: p.translationCompletion })}`;
}
export function prepareOcr(page: Page, overwrite = false): PreparedOcr | null {
  const targets = page.blocks.filter(b => overwrite || !String(b.sourceText ?? '').trim());
  if (!targets.length) return null;
  const dialogueRegions = targets.map((b, i) => {
    const rect = b.bbox as { x: number; y: number; w: number; h: number };
    const pixel = b.bboxSpace === 'pixels' ? rect : { x: (rect.x / 1000) * page.width,
      y: (rect.y / 1000) * page.height, w: (rect.w / 1000) * page.width, h: (rect.h / 1000) * page.height };
    const bbox = [Math.round(pixel.x), Math.round(pixel.y), Math.round(pixel.x + pixel.w), Math.round(pixel.y + pixel.h)];
    const origin = b.workflowOrigin as Record<string, unknown> | undefined;
    const clip = (boxes: number[][]) => boxes.map(([x1, y1, x2, y2]) =>
      [Math.max(bbox[0]!, x1!), Math.max(bbox[1]!, y1!), Math.min(bbox[2]!, x2!), Math.min(bbox[3]!, y2!)]);
    let subdivision;
    if (origin?.geometryKey === regionKey(page, b) && origin.ocrSubdivision) {
      const s = origin.ocrSubdivision as { mode: string; bboxes: number[][] };
      const bboxes = clip(s.bboxes);
      if (bboxes.every(([x1, y1, x2, y2]) => x2! > x1! && y2! > y1!)) subdivision = { mode: s.mode, bboxes };
    }
    return { id: i + 1, regionId: b.id, kind: 'dialogue', bbox, detectorConfidence: b.confidence,
      sourceDetectionIds: [], recognitionBboxes: origin?.geometryKey === regionKey(page, b) ? origin.recognitionBboxes : undefined,
      ocrSubdivision: subdivision };
  });
  return { pageId: page.id, pageRevision: pageRevision(page), inputKey: stageKey(page),
    targetBlockIds: targets.map(b => String(b.id)), page,
    manifest: { schemaVersion: 'hayai-dialogue-effect-separated-v1', width: page.width, height: page.height,
      dialogueRegions, effectRegions: [], diagnostics: { dialogueFragmentMerges: 0, dialogueOverlapMerges: 0,
        dialogueOverlapCuts: 0, dialogueOwnershipSkips: 0, rejectedDialogueCount: 0,
        effectOverlapMerges: 0, effectOverlapCuts: 0, rejectedEffectCount: 0 } } };
}
export function applyOcr(page: Page, prepared: PreparedOcr, hints: Hint[]): StageResult {
  if (page.id !== prepared.pageId || pageRevision(page) !== prepared.pageRevision || stageKey(page) !== prepared.inputKey)
    throw new Error('The page changed after HayaiOCR batch preparation.');
  for (const hint of hints) {
    if (!Number.isInteger(hint.id) || hint.id <= 0 || (hint.ocrText !== undefined && typeof hint.ocrText !== 'string'))
      throw new Error('Invalid OCR result hint');
    if (hint.recognitionSegments?.some(segment => !['x1', 'y1', 'x2', 'y2'].every(k => Number.isFinite(segment[k as keyof typeof segment]))
      || typeof segment.ocrText !== 'string' || segment.ocrText.length > 20000)) throw new Error('Invalid OCR recognition segment');
    const health = hint.ocrHealth;
    if (health && (typeof health.status !== 'string' || (health.strategy !== undefined &&
      !['none', 'preemptive-subdivision', 'retry-subdivision'].includes(String(health.strategy))))) throw new Error('Invalid OCR health');
  }
  const byId = new Map(hints.map(h => [h.id, h]));
  const recognized = new Map(prepared.targetBlockIds.map((id, i) => [id, byId.get(i + 1)]));
  if (prepared.targetBlockIds.some(id => !recognized.get(id))) throw new Error('A dialogue block is missing its OCR result.');
  let failures = 0;
  const next = { ...page, blocks: page.blocks.map(b => {
    const h = recognized.get(String(b.id));
    if (!h) return b;
    const failed = h.ocrHealth?.status === 'failed';
    if (failed) failures++;
    return { ...b, sourceText: failed ? '' : h.ocrText ?? '', ...(b.workflowOrigin ? { workflowOrigin: {
      ...b.workflowOrigin as Record<string, unknown>, recognitionSegments: h.recognitionSegments,
      ocrFailure: failed ? { reason: 'generation-budget-exhausted', strategy: h.ocrHealth?.strategy ?? 'none',
        rawText: (h.ocrText ?? '').slice(0, 20000) } : undefined } } : {}) };
  }) };
  return failures ? { status: 'failed', page: next, retryable: true,
    message: `OCR CHECK: ${failures}개 블록의 원문 인식이 실패했습니다(HayaiOCR 생성 한도 소진). 원문을 직접 확인해 입력한 뒤 이어서 실행하세요.` }
    : { status: 'completed', page: next };
}
export function ocrStage(read: ReadOcr): Stage {
  const cached = new Map<string, { prepared: PreparedOcr; hints: Hint[] }>();
  return { id: 'ocr', reads: ['imagePath', 'width', 'height', 'blocks', 'workflowOrigin'],
    writes: ['sourceText', 'workflowOrigin.recognitionSegments', 'workflowOrigin.ocrFailure'], resources: ['Hayai Python process'],
    async prepare(pages) {
      cached.clear();
      const inputs = pages.map(p => prepareOcr(p)).filter((p): p is PreparedOcr => p !== null);
      if (!inputs.length) return;
      const results = await read(inputs);
      if (results.length !== inputs.length) throw new Error('HayaiOCR batch returned an unexpected result count.');
      inputs.forEach((prepared, i) => cached.set(prepared.pageId, { prepared, hints: results[i]! }));
    },
    async execute(page) {
      const existing = cached.get(page.id);
      if (existing) return applyOcr(page, existing.prepared, existing.hints);
      const prepared = prepareOcr(page);
      if (!prepared) return { status: page.blocks.length ? 'completed' : 'empty', page };
      const [hints] = await read([prepared]);
      return applyOcr(page, prepared, hints!);
    } };
}
