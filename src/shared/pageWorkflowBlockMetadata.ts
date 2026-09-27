import { z } from "zod";

const PixelBox = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const WorkflowRecognitionSegmentSchema = z.object({
  x1: z.number().finite(),
  y1: z.number().finite(),
  x2: z.number().finite(),
  y2: z.number().finite(),
  ocrText: z.string().max(20000),
});
const WorkflowOcrSubdivisionSchema = z
  .object({
    mode: z.enum(["preemptive", "retry"]),
    bboxes: z.array(PixelBox).min(2).max(8),
  })
  .strict();
/** OCR CHECK: Hayai output that exhausted its generation budget unrecovered. */
const WorkflowOcrFailureSchema = z
  .object({
    reason: z.literal("generation-budget-exhausted"),
    strategy: z.enum(["none", "preemptive-subdivision", "retry-subdivision"]),
    rawText: z.string().max(20000),
  })
  .strict();
export const WorkflowBlockMetadataSchema = z
  .object({
    geometryKey: z.string().max(100),
    recognitionBboxes: z.array(PixelBox).max(100).optional(),
    recognitionSegments: z
      .array(WorkflowRecognitionSegmentSchema)
      .max(100)
      .optional(),
    ocrSubdivision: WorkflowOcrSubdivisionSchema.optional(),
    ocrFailure: WorkflowOcrFailureSchema.optional(),
    initialFontSize: z.number().finite(),
    initialFontFamily: z.string().optional(),
    initialFontStyle: z
      .object({
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        fontWeight: z.number().optional(),
        textColor: z.string(),
        outlineColor: z.string().optional(),
      })
      .strict()
      .optional(),
    fontApplied: z.boolean().optional(),
    sizeApplied: z.boolean().optional(),
  })
  .strict();

export type WorkflowBlockMetadata = z.infer<typeof WorkflowBlockMetadataSchema>;
