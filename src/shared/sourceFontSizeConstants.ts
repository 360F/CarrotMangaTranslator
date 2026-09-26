// The same small optical step used by source-matched target typography.
export const SOURCE_MATCH_OPTICAL_SCALE = 1.06;

// Raster face measurements exclude the em's surrounding ascender/descender
// space. Use a conservative generic face-to-em ratio when the source font is
// unknown; the erase scale is subsequently clamped against the legacy value.
export const DEFAULT_SOURCE_FACE_TO_EM_RATIO = 0.8;
