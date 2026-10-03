// Ported from src/main/pipeline/failure.ts, reference fd461737. Runtime independent of Carrot.
const JOB_FAILURE_GUIDANCE = new Set([
    "increase-max-output-tokens",
    "increase-work-context-budget",
    "increase-context-length",
]);
const FAILURE_MESSAGE_RULES = [
    {
        category: "image-preprocessing",
        terms: ["build-page-variant"],
    },
    {
        category: "server-startup",
        terms: ["llama-server", "bundled llama-server", "timed out while waiting"],
    },
    {
        category: "model-request",
        terms: [
            "gemma request failed",
            "openai codex request failed",
            "api 오류",
            "request transport failed",
            "codex app server",
        ],
    },
    {
        category: "response-json-parse",
        terms: ["json parse failed"],
    },
    {
        category: "overlay-parse",
        terms: [
            "구조화 형식으로 해석하지 못했습니다",
            "parseable structured payload",
        ],
    },
    {
        category: "empty-model-response",
        terms: ["empty response"],
    },
    {
        category: "empty-overlay-items",
        terms: ["bbox 결과를 만들지 못했습니다"],
    },
];
export function summarizePage(page) {
    return {
        id: page.id,
        name: page.name,
        imagePath: page.imagePath,
        width: page.width,
        height: page.height,
        analysisStatus: page.analysisStatus,
    };
}
export function classifyFailure(error) {
    const explicitCategory = readFailureCategory(error);
    if (explicitCategory) {
        return explicitCategory;
    }
    if (isNonRetriableRuntimeError(error)) {
        return "runtime";
    }
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return classifyFailureMessage(message);
}
export function readJobFailureGuidance(error) {
    if (!error || typeof error !== "object" || !("failureGuidance" in error)) {
        return undefined;
    }
    const guidance = error.failureGuidance;
    return typeof guidance === "string" &&
        JOB_FAILURE_GUIDANCE.has(guidance)
        ? guidance
        : undefined;
}
function readFailureCategory(error) {
    if (error &&
        typeof error === "object" &&
        "failureCategory" in error &&
        typeof error.failureCategory === "string") {
        return error.failureCategory;
    }
    return null;
}
function classifyFailureMessage(message) {
    return (FAILURE_MESSAGE_RULES.find((rule) => rule.terms.some((term) => message.includes(term)))?.category ?? "unknown");
}
export function isNonRetriableRuntimeError(error) {
    return Boolean(error &&
        typeof error === "object" &&
        "nonRetriable" in error &&
        error.nonRetriable);
}
export function isAbortErrorLike(error) {
    return error instanceof DOMException && error.name === "AbortError";
}
export function throwIfAborted(signal) {
    if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
}
