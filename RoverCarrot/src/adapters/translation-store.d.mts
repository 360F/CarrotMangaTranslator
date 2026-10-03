import type { Chapter, Config, PendingMemory, TranslationContext } from '../core/contracts.js';
export function translationStore(log?: (type: string, fields: Record<string, unknown>) => void): {
 context: () => TranslationContext; initialize: (chapter: Chapter, config: Config) => Promise<void>;
 commit: (chapter: Chapter, pending?: PendingMemory) => Promise<boolean>;
};
