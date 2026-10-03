import { workflowOverlayItems } from './ported/main/pageWorkflow/pageWorkflowTypographyInput.mjs';
import { mergeWorkflowTypography } from './ported/main/pageWorkflow/pageWorkflowTypographyMerge.mjs';
import { estimatePageSourceFontSizes } from './ported/main/pipeline/sourceFontSizeEstimator.mjs';
import { applySizeOptions } from './ported/main/pipeline/overlayFontSize.mjs';
import { workflowTypographyFields } from './ported/shared/pageWorkflowPolicy.mjs';

export const defaultPlan = { autoFont: false, autoSize: true, bubbleLayout: true, naturalLayout: false, overwrite: [] };
export async function applyTypography(page, loadRaster, plan = defaultPlan, signal, logWarning) {
  if (plan.autoFont) throw new Error('autoFont implementation awaits D17');
  if (!page.blocks.some(block => workflowTypographyFields(block, plan).size)) return page;
  const items = workflowOverlayItems(page);
  const estimates = await estimatePageSourceFontSizes({ enabled: plan.autoSize, items, page, signal, loadRaster, logWarning });
  const result = { ...page, blocks: page.blocks.map((block, index) => estimates[index]
    ? applySizeOptions(block, undefined, { fontSizeAutoFit: true, sourceFontSize: estimates[index] }) : block) };
  return mergeWorkflowTypography(page, result, plan);
}
