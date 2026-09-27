import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { WorkflowRecognitionSegmentSchema } from "../../shared/pageWorkflowBlockMetadata";
import { join } from "node:path";
import type { MangaPage } from "../../shared/libraryTypes";
import type { PageWorkflowPlan } from "../../shared/pageWorkflowTypes";
import { createPageRevision } from "../../shared/pageRevision";
import { pixelsToBbox } from "../../shared/bboxNormalization";
import {
  workflowRegionKey,
  workflowStageKey,
  workflowTargetBlocks,
} from "../../shared/pageWorkflowPolicy";
import { overlayItemToBlock } from "../pipeline/overlayItems";
import { prepareHayaiRegions } from "../textDetection/hayaiRegionPrepass";
import type { HayaiRegionManifest } from "../textDetection/hayaiRegionGeometry";
import type { TranslationOptions } from "../appSettings";
import type { TranslationRuntimePort } from "../pipeline/translationRuntimePort";
import type { OcrBboxResult } from "../pipeline/types";
import { buildKeepBlocksOcrResult } from "../pipeline/keepBlocksResult";
import { PageWorkflowPartialFailure } from "../application/pageWorkflowPartialFailure";

export async function detectWorkflowBlocks(
  page: MangaPage,
  options: TranslationOptions,
  plan: PageWorkflowPlan,
  detect: typeof prepareHayaiRegions = prepareHayaiRegions,
): Promise<MangaPage> {
  if (page.blocks.length && !plan.overwrite.includes("detect")) return page;
  if (
    !plan.overwrite.includes("detect") &&
    page.pageWorkflow?.emptyDetectionKey === workflowStageKey(page, "detect")
  )
    return page;
  const { manifest } = await detect(options);
  const detectionId = randomUUID();
  const blocks = manifest.dialogueRegions.map((region, index) => {
    const block = overlayItemToBlock(
      {
        id: region.id,
        type: "nonsolid",
        textRole: "ordinary",
        jp: "",
        ko: "",
        bbox: normalizedRegion(region.bbox, page),
        confidence: region.detectorConfidence,
      },
      page,
      index,
      detectionId,
      options.blockFormatDefaults,
    );
    return {
      ...block,
      textDisplayMode: "translation-only" as const,
      workflowOrigin: {
        geometryKey: workflowRegionKey(page, block),
        recognitionBboxes: region.recognitionBboxes,
        ocrSubdivision: region.ocrSubdivision,
        initialFontSize: block.fontSizePx,
        initialFontFamily: block.fontFamily,
        initialFontStyle: {
          bold: block.bold,
          italic: block.italic,
          fontWeight: block.fontWeight,
          textColor: block.textColor,
          outlineColor: block.outlineColor,
        },
      },
    };
  });
  return {
    ...page,
    blocks,
    blockOrder: blocks.map((block) => block.id),
    analysisStatus: "idle",
    translationCheckpoint: undefined,
    translationCompletion: undefined,
    soundEffectReview: {
      contractVersion: 3,
      producer: "hayai-regions-v1",
      regionOverrides: [],
      manualRegions: [],
      resolvedRegions: [],
      regions: manifest.effectRegions.map((region) => ({
        id: region.regionId,
        bbox: normalizedRegion(region.bbox, page),
        detectorConfidence: region.detectorConfidence,
        sourceDetectionIds: region.sourceDetectionIds,
      })),
    },
  };
}

export type PreparedWorkflowOcrInput = {
  inputKey: string;
  options: TranslationOptions;
  pageId: string;
  pageRevision: string;
  targetBlockIds: string[];
};

export async function prepareWorkflowOcrInput(
  page: MangaPage,
  options: TranslationOptions,
  plan: PageWorkflowPlan,
): Promise<PreparedWorkflowOcrInput | null> {
  const targets = workflowTargetBlocks(page, "ocr", plan);
  if (!targets.length) return null;
  const manifest = manifestForBlocks(page, targets);
  await mkdir(options.outputDir, { recursive: true });
  const path = join(options.outputDir, "workflow-regions.json");
  await writeFile(path, JSON.stringify(manifest), "utf8");
  return {
    inputKey: workflowStageKey(page, "ocr"),
    options: { ...options, ocrBboxRegionsPath: path },
    pageId: page.id,
    pageRevision: createPageRevision(page),
    targetBlockIds: targets.map((block) => block.id),
  };
}

export function applyWorkflowOcrResult(
  page: MangaPage,
  prepared: PreparedWorkflowOcrInput,
  result: OcrBboxResult,
): MangaPage {
  if (
    page.id !== prepared.pageId ||
    createPageRevision(page) !== prepared.pageRevision ||
    workflowStageKey(page, "ocr") !== prepared.inputKey
  )
    throw new Error("The page changed after HayaiOCR batch preparation.");
  const hints = z
    .array(
      z.object({
        id: z.number().int().positive(),
        ocrText: z.string().default(""),
        recognitionSegments: z
          .array(WorkflowRecognitionSegmentSchema)
          .optional(),
        ocrHealth: z
          .object({
            status: z.string(),
            strategy: z
              .enum(["none", "preemptive-subdivision", "retry-subdivision"])
              .optional(),
          })
          .optional(),
      }),
    )
    .parse(result.hints);
  const byId = new Map(hints.map((hint) => [hint.id, hint]));
  const recognized = new Map(
    prepared.targetBlockIds.map((blockId, index) => [
      blockId,
      byId.get(index + 1),
    ]),
  );
  if (prepared.targetBlockIds.some((blockId) => !recognized.get(blockId)))
    throw new Error("A dialogue block is missing its OCR result.");
  const next: MangaPage = {
    ...page,
    blocks: page.blocks.map((block) => {
      const hint = recognized.get(block.id);
      if (!hint) return block;
      const failed = hint.ocrHealth?.status === "failed";
      // A degenerate read is kept only as review evidence, never as source
      // text, so translation cannot receive it as ordinary dialogue.
      return {
        ...block,
        sourceText: failed ? "" : hint.ocrText,
        ...(block.workflowOrigin
          ? {
              workflowOrigin: {
                ...block.workflowOrigin,
                recognitionSegments: hint.recognitionSegments,
                ocrFailure: failed
                  ? {
                      reason: "generation-budget-exhausted" as const,
                      strategy: hint.ocrHealth?.strategy ?? "none",
                      rawText: hint.ocrText.slice(0, 20000),
                    }
                  : undefined,
              },
            }
          : {}),
      };
    }),
  };
  const failures = prepared.targetBlockIds.filter(
    (blockId) => recognized.get(blockId)?.ocrHealth?.status === "failed",
  );
  if (failures.length)
    throw new PageWorkflowPartialFailure(
      `OCR CHECK: ${failures.length}개 블록의 원문 인식이 실패했습니다(HayaiOCR 생성 한도 소진). 원문을 직접 확인해 입력한 뒤 이어서 실행하세요.`,
      next,
    );
  return next;
}

export async function readWorkflowSource(
  page: MangaPage,
  options: TranslationOptions,
  plan: PageWorkflowPlan,
  runtime: TranslationRuntimePort,
): Promise<MangaPage> {
  const prepared = await prepareWorkflowOcrInput(page, options, plan);
  if (!prepared) return page;
  if (!runtime.collectPreparedHayaiHints)
    throw new Error("HayaiOCR fixed-region recognition is unavailable.");
  const result = await runtime.collectPreparedHayaiHints(prepared.options);
  return applyWorkflowOcrResult(page, prepared, result);
}

function manifestForBlocks(
  page: MangaPage,
  blocks: MangaPage["blocks"],
): HayaiRegionManifest {
  const hints = buildKeepBlocksOcrResult({ ...page, blocks }).hints as Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
  return {
    schemaVersion: "hayai-dialogue-effect-separated-v1",
    width: page.width,
    height: page.height,
    dialogueRegions: blocks.map((block, index) => ({
      id: index + 1,
      regionId: block.id,
      kind: "dialogue",
      bbox: [
        hints[index].x1,
        hints[index].y1,
        hints[index].x2,
        hints[index].y2,
      ],
      detectorConfidence: block.confidence,
      sourceDetectionIds: [],
      recognitionBboxes:
        block.workflowOrigin?.geometryKey === workflowRegionKey(page, block)
          ? block.workflowOrigin.recognitionBboxes
          : undefined,
      ocrSubdivision:
        block.workflowOrigin?.geometryKey === workflowRegionKey(page, block)
          ? clipOcrSubdivision(block.workflowOrigin.ocrSubdivision, [
              hints[index].x1,
              hints[index].y1,
              hints[index].x2,
              hints[index].y2,
            ])
          : undefined,
    })),
    effectRegions: [],
    diagnostics: {
      dialogueFragmentMerges: 0,
      dialogueOverlapMerges: 0,
      dialogueOverlapCuts: 0,
      dialogueOwnershipSkips: 0,
      rejectedDialogueCount: 0,
      effectOverlapMerges: 0,
      effectOverlapCuts: 0,
      rejectedEffectCount: 0,
    },
  };
}

// The block bbox round-trips through normalized coordinates, so the stored
// crops are clipped to the manifest bbox that Hayai validates them against.
function clipOcrSubdivision(
  subdivision: HayaiRegionManifest["dialogueRegions"][number]["ocrSubdivision"],
  [left, top, right, bottom]: [number, number, number, number],
): HayaiRegionManifest["dialogueRegions"][number]["ocrSubdivision"] {
  if (!subdivision) return undefined;
  const bboxes = subdivision.bboxes.map(
    ([x1, y1, x2, y2]) =>
      [
        Math.max(left, x1),
        Math.max(top, y1),
        Math.min(right, x2),
        Math.min(bottom, y2),
      ] as [number, number, number, number],
  );
  return bboxes.every(([x1, y1, x2, y2]) => x2 > x1 && y2 > y1)
    ? { mode: subdivision.mode, bboxes }
    : undefined;
}

function normalizedRegion(
  box: [number, number, number, number],
  page: MangaPage,
) {
  return pixelsToBbox(
    { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] },
    page.width,
    page.height,
  );
}
