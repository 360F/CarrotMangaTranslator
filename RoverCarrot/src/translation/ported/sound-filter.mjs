import {clamp} from './geometry.mjs';
// Ported from src/main/pipeline/overlayItems.ts, reference fd461737. Runtime independent of Carrot.
const REQUIRED_SOUND_CONFIDENCE = 1;
export function filterRejectedOrUncertainSoundItems(items, options = {}) {
    const dropUncertainSound = options.dropUncertainSound ?? true;
    const filtered = [];
    let droppedCount = 0;
    for (const item of items) {
        const textRole = normalizeOverlayTextRole(item.textRole);
        if (textRole === "nontext") {
            droppedCount += 1;
            continue;
        }
        if (dropUncertainSound &&
            textRole === "sound" &&
            normalizeConfidence(item.confidence, 0) < REQUIRED_SOUND_CONFIDENCE) {
            droppedCount += 1;
            continue;
        }
        filtered.push(item);
    }
    return { items: filtered, droppedCount };
}
function normalizeConfidence(value, fallback) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
    return clamp(normalized, 0, 1);
}
function normalizeOverlayTextRole(value) {
    const text = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[_\s-]+/g, "");
    if (!text) {
        return "";
    }
    if ([
        "sound",
        "sfx",
        "soundeffect",
        "effect",
        "reaction",
        "onomatopoeia",
    ].includes(text)) {
        return "sound";
    }
    if ([
        "ordinary",
        "speech",
        "dialogue",
        "dialog",
        "bubble",
        "caption",
        "narration",
        "label",
        "sign",
        "note",
        "title",
    ].includes(text)) {
        return "ordinary";
    }
    if ([
        "nontext",
        "nottext",
        "reject",
        "decoration",
        "texture",
        "ornament",
    ].includes(text)) {
        return "nontext";
    }
    return "";
}
