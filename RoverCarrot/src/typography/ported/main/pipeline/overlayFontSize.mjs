// Ported from read-only fork fd461737. See source-map.json.
import { applyFormatDefaultsToBlock, } from "../../shared/blockFormat.mjs";
export function applySizeOptions(block, formatDefaults, options) {
    const formatted = applyFormatDefaultsToBlock(block, formatDefaults);
    const sourceAware = options?.sourceFontSize
        ? {
            ...formatted,
            sourceFontFacePx: options.sourceFontSize.facePx,
            sourceFontSizeConfidence: options.sourceFontSize.confidence,
            sourceFontSizeMethod: options.sourceFontSize.method,
        }
        : formatted;
    const aiFontSizeMatching = options?.aiFontSizeMatching ?? options?.fontSizeAutoFit;
    if (aiFontSizeMatching === undefined)
        return sourceAware;
    return {
        ...sourceAware,
        autoFitText: false,
        fontSizePx: block.fontSizePx,
        fontSizeIntent: aiFontSizeMatching ? "source-match" : "manual",
    };
}
