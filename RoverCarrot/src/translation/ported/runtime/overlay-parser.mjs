// Ported from src/main/runtime/overlay-parser.cjs, reference fd461737. Runtime independent of Carrot.
// @ts-check

import {
  extractJsonCandidate,
  parseJsonLenient,
  parseRegionSingleItem,
  repairBrokenJson,
  stripModelSpecialTokens,
} from "./parsing/overlay-json-recovery.mjs";
import {
  normalizeItems,
  normalizeRegionSingleItem,
} from "./parsing/overlay-items.mjs";

export {
  extractJsonCandidate,
  normalizeItems,
  normalizeRegionSingleItem,
  parseJsonLenient,
  parseRegionSingleItem,
  repairBrokenJson,
  stripModelSpecialTokens,
};
