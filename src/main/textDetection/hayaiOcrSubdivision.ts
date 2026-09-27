type PixelBox = [number, number, number, number];

export type HayaiOcrSubdivision = {
  /**
   * `preemptive`: the whole crop is too dense for Hayai's patch budget, so the
   * segments are read instead of the logical bbox. `retry`: the logical bbox is
   * read first and the segments are used once only if that read degenerates.
   */
  mode: "preemptive" | "retry";
  bboxes: PixelBox[];
};

type SubdivisionInput = {
  bbox: PixelBox;
  masks: readonly Uint8Array[];
  maskWidth: number;
  maskHeight: number;
  pageWidth: number;
  pageHeight: number;
};

// Pinned SigLIP2 naflex processor used by hayai-bboxes.py.
const HAYAI_PATCH_SIZE = 16;
const HAYAI_MAX_NUM_PATCHES = 256;
// hayai-bboxes.py accepts two to eight recognition crops per dialogue region.
const MAX_OCR_SEGMENTS = 8;
// A text line is a projection band clearly above the gaps between lines.
const TEXT_BAND_MIN_PEAK_RATIO = 0.3;
const TEXT_BAND_MIN_CELLS = 3;
const SEGMENT_PADDING_PX = 3;

/**
 * Plans OCR-only crops for one dialogue region from its detector masks.
 * The logical region is unchanged. Only vertical Japanese text is split:
 * a region at least as tall as wide whose mask shows two or more columns is
 * cut into column groups ordered right to left. Detector masks cannot tell a
 * horizontal paragraph from a column grid reliably, so any other layout keeps
 * the whole-region read.
 */
export function planHayaiOcrSubdivision(
  input: SubdivisionInput,
): HayaiOcrSubdivision | undefined {
  const [left, top, right, bottom] = input.bbox;
  if (bottom - top < right - left) return undefined;
  const cellWidth = input.pageWidth / input.maskWidth;
  const cellHeight = input.pageHeight / input.maskHeight;
  const mask = regionMask(input, cellWidth, cellHeight);
  const columns = textBands(columnProfile(mask, input));
  const columnsPerSegment = Math.ceil(columns.length / MAX_OCR_SEGMENTS);
  const segments: PixelBox[] = [];
  for (let index = 0; index < columns.length; index += columnsPerSegment) {
    const group = columns.slice(index, index + columnsPerSegment);
    const segment = columnGroupBox(
      mask,
      input,
      [group[0][0], group[group.length - 1][1]],
      cellWidth,
      cellHeight,
    );
    if (segment) segments.push(segment);
  }
  if (segments.length < 2) return undefined;
  const columnWidthPx = median(
    columns.map(([start, end]) => (end - start) * cellWidth),
  );
  return {
    mode:
      columnWidthPx * hayaiResizeScale(input.bbox) < HAYAI_PATCH_SIZE
        ? "preemptive"
        : "retry",
    bboxes: segments.reverse(),
  };
}

/**
 * Mirrors the naflex resize that fits the pixel crop into the patch budget:
 * the largest scale whose patch-aligned size keeps at most 256 patches.
 */
export function hayaiResizeScale(bbox: PixelBox): number {
  const width = Math.ceil(bbox[2]) - Math.floor(bbox[0]);
  const height = Math.ceil(bbox[3]) - Math.floor(bbox[1]);
  const patches = (size: number, scale: number) =>
    Math.max(1, Math.ceil((size * scale) / HAYAI_PATCH_SIZE));
  let low = 1e-6;
  let high = 100;
  while (high - low >= 1e-5) {
    const scale = (low + high) / 2;
    if (patches(width, scale) * patches(height, scale) <= HAYAI_MAX_NUM_PATCHES)
      low = scale;
    else high = scale;
  }
  return low;
}

function regionMask(
  input: SubdivisionInput,
  cellWidth: number,
  cellHeight: number,
): Uint8Array {
  const mask = new Uint8Array(input.maskWidth * input.maskHeight);
  for (let y = 0; y < input.maskHeight; y += 1) {
    const centerY = (y + 0.5) * cellHeight;
    if (centerY < input.bbox[1] || centerY > input.bbox[3]) continue;
    for (let x = 0; x < input.maskWidth; x += 1) {
      const centerX = (x + 0.5) * cellWidth;
      if (centerX < input.bbox[0] || centerX > input.bbox[2]) continue;
      const index = y * input.maskWidth + x;
      if (input.masks.some((source) => source[index])) mask[index] = 1;
    }
  }
  return mask;
}

function columnProfile(mask: Uint8Array, input: SubdivisionInput): number[] {
  const profile = new Array<number>(input.maskWidth).fill(0);
  for (let y = 0; y < input.maskHeight; y += 1) {
    for (let x = 0; x < input.maskWidth; x += 1) {
      if (mask[y * input.maskWidth + x]) profile[x] += 1;
    }
  }
  return profile;
}

function textBands(profile: readonly number[]): Array<[number, number]> {
  const filled = profile.filter((value) => value > 0).sort((a, b) => a - b);
  if (!filled.length) return [];
  const peak =
    filled[Math.min(filled.length - 1, Math.floor(filled.length * 0.9))];
  const threshold = peak * TEXT_BAND_MIN_PEAK_RATIO;
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let index = 0; index <= profile.length; index += 1) {
    const inside = index < profile.length && profile[index] > threshold;
    if (inside && start < 0) start = index;
    if (!inside && start >= 0) {
      if (index - start >= TEXT_BAND_MIN_CELLS) bands.push([start, index]);
      start = -1;
    }
  }
  return bands;
}

function columnGroupBox(
  mask: Uint8Array,
  input: SubdivisionInput,
  [start, end]: [number, number],
  cellWidth: number,
  cellHeight: number,
): PixelBox | undefined {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let x = start; x < end; x += 1) {
    for (let y = 0; y < input.maskHeight; y += 1) {
      if (!mask[y * input.maskWidth + x]) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  }
  if (!Number.isFinite(top)) return undefined;
  const box: PixelBox = [
    Math.max(input.bbox[0], start * cellWidth - SEGMENT_PADDING_PX),
    Math.max(input.bbox[1], top * cellHeight - SEGMENT_PADDING_PX),
    Math.min(input.bbox[2], end * cellWidth + SEGMENT_PADDING_PX),
    Math.min(input.bbox[3], bottom * cellHeight + SEGMENT_PADDING_PX),
  ];
  return box[2] > box[0] && box[3] > box[1] ? box : undefined;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
