// Selected managed request functions from src/main/runtime/simple-page-request-builders.cjs (fd461737).
import {getOverlayPrompt,buildSystemPrompt,readPositiveInteger} from './runtime/simple-page-prompts.mjs';
const IMAGE_VARIANT_DESCRIPTIONS={"openai-vision":"the full manga page prepared for OpenAI detail: original vision. Use it as the geometry authority.",enhanced:"the same full manga page rendered as grayscale/high-contrast assist view. Use it only for OCR help, never as the coordinate authority."};
const DEFAULT_IMAGE_VARIANT_DESCRIPTION="the original full manga page. Use it as the geometry authority.";
const REGION_CROP_DESCRIPTION="the selected manga crop. Use it as the geometry authority.";
function buildMessages(
  options,
  imageVariants,
  promptOverride,
  systemPromptOverride,
) {
  const promptText =
    promptOverride ||
    options.promptOverrideText ||
    getOverlayPrompt(options, imageVariants);
  const imageParts = imageVariants.flatMap((variant, index) => [
    {
      type: "image_url",
      image_url: {
        url: variant.dataUrl,
      },
    },
    {
      type: "text",
      text: describeImageVariant(variant, index, options),
    },
  ]);

  return [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: systemPromptOverride || buildSystemPrompt(options),
        },
      ],
    },
    {
      role: "user",
      content: [...imageParts, { type: "text", text: promptText }],
    },
  ];
}
function describeImageVariant(variant, index, options = {}) {
  if (variant.role === "full-page-context") {
    return describeFullPageContextVariant(variant, index, options);
  }

  const description = resolveImageVariantDescription(variant, index, options);
  return `Image ${index + 1}: ${description}${describeImageVariantDimensions(variant, options)}`;
}
function resolveImageVariantDescription(variant, index, options) {
  if (options.regionCropMode && index === 0) {
    return REGION_CROP_DESCRIPTION;
  }
  return (
    IMAGE_VARIANT_DESCRIPTIONS[variant.role] ??
    DEFAULT_IMAGE_VARIANT_DESCRIPTION
  );
}
function describeImageVariantDimensions(variant, options) {
  const originalWidth =
    readPositiveInteger(options.imageWidth) ||
    readPositiveInteger(variant.originalWidth);
  const originalHeight =
    readPositiveInteger(options.imageHeight) ||
    readPositiveInteger(variant.originalHeight);
  const width = readPositiveInteger(variant.width);
  const height = readPositiveInteger(variant.height);
  const sizeText = width && height ? ` It is ${width}x${height} px.` : "";
  const originalSizeText =
    originalWidth && originalHeight
      ? ` Original page size is ${originalWidth}x${originalHeight} px.`
      : "";
  return `${sizeText}${originalSizeText}`;
}
function describeFullPageContextVariant(variant, index, options = {}) {
  const width = readPositiveInteger(variant.width);
  const height = readPositiveInteger(variant.height);
  const crop = readRegionContextCropRect(options.regionContextCropRect);
  const sizeText = width && height ? ` It is ${width}x${height} px.` : "";
  const cropText = crop
    ? ` The selected Image 1 crop comes from this full page at x=${crop.x}, y=${crop.y}, w=${crop.w}, h=${crop.h} original-page pixels.`
    : "";
  return `Image ${index + 1}: the original full manga page for selected-region context only. Use it to understand speaker, surrounding scene, nearby dialogue flow, and whether Image 1 is part of a larger balloon. Do not use it as the coordinate authority, and do not output text visible only outside Image 1.${sizeText}${cropText}`;
}
function readRegionContextCropRect(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const x = readNonNegativeInteger(record.x);
  const y = readNonNegativeInteger(record.y);
  const w = readPositiveInteger(record.w);
  const h = readPositiveInteger(record.h);
  return x !== null && y !== null && w && h ? { x, y, w, h } : null;
}
function readNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}
function resolveGemmaReasoningBudget(options) {
  const configured = Number(options.gemmaReasoningBudget);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 0;
}
export {buildMessages,resolveGemmaReasoningBudget};
