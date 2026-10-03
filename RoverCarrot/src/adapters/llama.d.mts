import type { TranslationConfig } from '../core/contracts.js';
export type PreparedLlama = { binary: string; env: NodeJS.ProcessEnv; template: string; identity: unknown; models: unknown };
export function preflight(config: TranslationConfig, projectRoot: string, signal?: AbortSignal): Promise<PreparedLlama>;
export function startManaged(config: TranslationConfig, prepared: PreparedLlama, options?: {
 signal?: AbortSignal; log?: (type: string, fields: Record<string, unknown>) => void;
}): Promise<{baseUrl: string; dispose: () => Promise<void>}>;
