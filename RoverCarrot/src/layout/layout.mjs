import { defaultPlan } from '../typography/typography.mjs';
import { workflowTargetBlocks } from '../typography/ported/shared/pageWorkflowPolicy.mjs';
import { runBubbleLayoutPostprocess } from '../typography/ported/main/inpainting/bubbleLayoutRunner.mjs';
import { applyNaturalTextLayout } from '../typography/ported/shared/naturalTextLayout.mjs';
export async function applyLayout(page, runner, plan = defaultPlan, signal = new AbortController().signal, locale) {
  const targets = workflowTargetBlocks(page, 'layout', plan);
  if (!targets.length || !page.blocks.length) return page;
  if (plan.bubbleLayout) return (await runBubbleLayoutPostprocess({ page, blockIds: targets.map(b => b.id), runner, signal,
    config: { policy: 'balanced', overwriteManual: plan.overwrite.includes('layout'),
      naturalTextLayout: plan.naturalLayout ? { locale } : undefined } })).page;
  if (!plan.naturalLayout) return page;
  const ids = new Set(targets.map(b => b.id));
  return { ...page, blocks: page.blocks.map(b => ids.has(b.id) && b.translatedText.trim() ? { ...b, translatedText: applyNaturalTextLayout(b,
    { enabled: true, pageSize: { width: page.width, height: page.height }, locale }).translatedText } : b) };
}
