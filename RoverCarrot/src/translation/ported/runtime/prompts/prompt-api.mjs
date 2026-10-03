// Ported from src/main/runtime/prompts/prompt-api.cjs, reference fd461737. Runtime independent of Carrot.
// @ts-check
/** @typedef {import("./prompt-types").PromptOptions} PromptOptions */
/** @typedef {import("./prompt-types").ImageVariant} ImageVariant */
/** @typedef {import("./prompt-types").PromptSection} PromptSection */

import { readPositiveInteger } from "./common.mjs";
import { resolvePromptCoordinateFrame } from "./coordinates.mjs";
import {
  readOcrCandidateText,
  sanitizeHintLabel,
  sanitizeOcrTextForPrompt,
} from "./ocr-text.mjs";
import { buildOverlayPrompt } from "./overlay-prompt.mjs";
import { buildSystemPrompt } from "./system-prompt.mjs";
import { buildWorkContextSection } from "./work-context.mjs";

/**
 * @param {PromptSection[]} baseSections
 * @returns {{
 *   PROMPT_KO_BBOX_LINES_MULTIVIEW: string;
 *   buildSystemPrompt: typeof buildSystemPrompt;
 *   buildWorkContextSection: typeof buildWorkContextSection;
 *   getOverlayPrompt: (options?: PromptOptions, imageVariants?: ImageVariant[]) => string;
 *   readOcrCandidateText: typeof readOcrCandidateText;
 *   readPositiveInteger: typeof readPositiveInteger;
 *   resolvePromptCoordinateFrame: typeof resolvePromptCoordinateFrame;
 *   sanitizeHintLabel: typeof sanitizeHintLabel;
 *   sanitizeOcrTextForPrompt: typeof sanitizeOcrTextForPrompt;
 * }}
 */
function createPromptApi(baseSections) {
  /**
   * @param {PromptOptions} [options]
   * @param {ImageVariant[]} [imageVariants]
   * @returns {string}
   */
  function getOverlayPrompt(options = {}, imageVariants = []) {
    return buildOverlayPrompt(baseSections, options, imageVariants);
  }

  return {
    PROMPT_KO_BBOX_LINES_MULTIVIEW: getOverlayPrompt(),
    buildSystemPrompt,
    buildWorkContextSection,
    getOverlayPrompt,
    readOcrCandidateText,
    readPositiveInteger,
    resolvePromptCoordinateFrame,
    sanitizeHintLabel,
    sanitizeOcrTextForPrompt,
  };
}

export { createPromptApi };
