// Same ordering as the reference workflow; render is its separate export phase.
export const STAGES = ['detect', 'ocr', 'source-rules', 'translate',
  'translation-rules', 'typography', 'format-rules', 'erase', 'layout',
  'review', 'render'] as const;
export type StageId = typeof STAGES[number];
export type Page = {
  id: string; name: string; imagePath: string; width: number; height: number;
  blocks: Record<string, unknown>[];
  analysisStatus: 'idle' | 'running' | 'completed' | 'failed';
  blockOrder?: string[];
  soundEffectReview?: Record<string, unknown>;
  createdAt: string; updatedAt: string;
};
export type Chapter = {
  id: string; workId: string; title: string; sourceKind: 'images' | 'folder';
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed';
  pageOrder: string[]; pages: Page[]; createdAt: string; updatedAt: string;
};
export type TranslationConfig = { backend: 'managed'; serverPath: string; modelPath: string; mmprojPath: string;
  modelIdentityPath: string; runtimeProfile: 'rtx50'; port?: number; sourceLanguage?: string; targetLanguage?: string;
  cumulative?: boolean; cumulativeDetail?: 'detailed' | 'essential'; styleGuidePath?: string; previousStoryPath?: string; previousChapterPath?: string;
  export?: boolean; exportRoot?: string; readingDirection?: 'rtl' | 'ltr' };
export type PendingMemory = { styleGuide: Record<string, unknown>; storyMemory: Record<string, unknown> };
export type TranslationContext = PendingMemory & { previousStoryPages?: Record<string, unknown>[]; pageIndexById?: Record<string, number> };
export type Config = {
  version: 1; mode: 'smoke'; input: string; output: string;
  stages: StageId[];
  typography?: { autoFont?: false; autoSize?: boolean; bubbleLayout?: boolean; naturalLayout?: boolean; overwrite?: ('typography' | 'layout')[] };
  translation?: TranslationConfig;
  models?: { koharu: string };
  ocr?: { python: string; hfCache: string; device: string; sourceLanguage: string; timeoutMs?: number };
};
export type Issue = { pageId?: string; stage?: StageId; message: string; retryable: boolean };
export type Event = {
  type: 'stage-start' | 'stage-end' | 'run-end'; runId: string;
  pageId?: string; stage?: StageId; status?: 'completed' | 'failed' | 'empty';
  elapsedMs?: number;
};
export type StageResult = { status: 'completed' | 'empty'; page: Page; pendingMemory?: PendingMemory } |
  { status: 'failed'; page: Page; message: string; retryable: boolean };
export type Stage = {
  id: StageId;
  // Explicit shared-state and runtime dependencies, refined in each port step.
  reads: readonly string[]; writes: readonly string[]; resources: readonly string[];
  prepare?: (pages: Page[]) => Promise<void>;
  execute: (page: Page) => Promise<StageResult>;
};
export type RunResult = {
  runId: string; mode: 'smoke'; status: 'completed' | 'partial' | 'failed';
  output: string; issues: Issue[]; events: Event[];
};
export type Persistence = {
  initialize: (config: Config) => Promise<Chapter>;
  // A translation commit includes its pending memory; no next page sees it before commit.
  commit: (chapter: Chapter, pendingMemory?: PendingMemory) => Promise<void>;
  finish: (result: RunResult) => Promise<void>;
};
