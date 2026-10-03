// Ported from src/main/runtime/transport/network-budgets.cjs, reference fd461737. Runtime independent of Carrot.
// @ts-check
const MAX_MODEL_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_TOKENIZE_RESPONSE_BYTES = 1 * 1024 * 1024;
const MODEL_HTTP_REQUEST_DEADLINE_MS = 30 * 60 * 1000;

export {
  MAX_MODEL_HTTP_RESPONSE_BYTES,
  MAX_TOKENIZE_RESPONSE_BYTES,
  MODEL_HTTP_REQUEST_DEADLINE_MS,
};
