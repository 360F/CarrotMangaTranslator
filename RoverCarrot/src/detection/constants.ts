/**
 * Production page-layout model. This replaces the legacy comic RT-DETR
 * detector completely; there is no legacy-model fallback path.
 */
export const KOHARU_LAYOUT_ONNX_REPO =
  "ShiniShiho/koharu-layout-rfdetr-seg-2xl-1152-onnx";
export const KOHARU_LAYOUT_ONNX_REVISION =
  "bfbbd4e5ab34a50459865074fa044da496cebb57";
export const KOHARU_LAYOUT_ONNX_FILE = "rfdetr-seg-2xlarge.onnx";
export const KOHARU_LAYOUT_ONNX_SHA256 =
  "7cc10d4316371946b8441da3512261a8e148b129abcdb0ea6235ed1d1d06d351";
export const KOHARU_LAYOUT_ONNX_BYTES = 148_442_003;
export const KOHARU_LAYOUT_INPUT_SIZE = 1152;
export const KOHARU_LAYOUT_QUERY_COUNT = 300;
export const KOHARU_LAYOUT_MASK_SIZE = 288;

export const KOHARU_LAYOUT_LABELS = [
  "text",
  "onomatopoeia",
  "bubble",
  "panel",
] as const;

/** Per-class thresholds published with the pinned KoharuLayout model. */
export const KOHARU_LAYOUT_SCORE_THRESHOLDS = [0.25, 0.2, 0.5, 0.5] as const;
