import { sanitizeOcrTextForPrompt } from './ocr-text.mjs';

export type OcrOptions = { sourceLanguage?: string; workContext?: unknown; glossaryOmissionTerms?: string[] };
export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Hint = Box & { id: number; ocrText?: string; recognitionSegments?: (Box & { ocrText: string })[];
  ocrHealth?: Record<string, unknown>; [key: string]: unknown };
export { sanitizeOcrTextForPrompt };

// Hayai output is pixel-space, with confirmed B#### partition metadata. The
// legacy adjacency grouper is bypassed in this reference path.
export function normalizeHayai(payload: { items: Record<string, unknown>[] }, width: number, height: number,
  options: OcrOptions = {}): Hint[] {
  const used = new Set<number>();
  const box = (r: Record<string, unknown>): Box | null => {
    const values = ['x1', 'y1', 'x2', 'y2'].map(k => Number(r[k]));
    if (!values.every(Number.isFinite)) return null;
    const [a, b, c, d] = values as [number, number, number, number];
    const x1 = Math.max(0, Math.round(Math.min(a, c))), y1 = Math.max(0, Math.round(Math.min(b, d)));
    const x2 = Math.min(width, Math.round(Math.max(a, c))), y2 = Math.min(height, Math.round(Math.max(b, d)));
    return x2 - x1 >= 2 && y2 - y1 >= 2 ? { x1, y1, x2, y2 } : null;
  };
  return payload.items.flatMap(r => {
    const rect = box(r);
    if (!rect) return [];
    let id = Number(r.id);
    if (!Number.isInteger(id) || id <= 0 || used.has(id)) { id = 1; while (used.has(id)) id++; }
    used.add(id);
    const hint: Hint = { label: 'text', ...rect, id };
    const score = Number(r.score ?? r.confidence);
    if (Number.isFinite(score)) hint.score = score;
    const text = sanitizeOcrTextForPrompt(r.ocrText, options);
    if (text) hint.ocrText = text;
    const segments = r.recognitionSegments;
    if (Array.isArray(segments) && segments.length >= 2 && segments.length <= 8) {
      const normalized = segments.flatMap((s: Record<string, unknown>) => {
        const b = box(s);
        if (!b || b.x1 < rect.x1 - 1 || b.y1 < rect.y1 - 1 || b.x2 > rect.x2 + 1 || b.y2 > rect.y2 + 1) return [];
        return [{ ...b, ocrText: sanitizeOcrTextForPrompt(s.ocrText, options) }];
      });
      if (normalized.length === segments.length) hint.recognitionSegments = normalized;
    }
    const h = r.ocrHealth as Record<string, unknown> | undefined;
    if (h && ['subdivided', 'recovered', 'failed'].includes(String(h.status))) {
      hint.ocrHealth = { status: h.status };
      for (const k of ['reason', 'strategy', 'regionId']) if (typeof h[k] === 'string') hint.ocrHealth[k] = h[k];
      if (Number.isInteger(h.segments)) hint.ocrHealth.segments = h.segments;
    }
    hint.reviewFragmentId = r.reviewFragmentId;
    hint.reviewStatus = r.reviewStatus;
    hint.reviewOrder = r.reviewOrder;
    hint.reviewReasons = [];
    if (r.geometryLocked === true) hint.geometryLocked = true;
    return [hint];
  }).slice(0, 80);
}
