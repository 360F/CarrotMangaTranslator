import { STAGES, type Stage } from '../core/contracts.js';
// Deliberately no-op. Never creates translation completion receipts or raster outputs.
export function smokeStages(): Stage[] {
  return STAGES.map(id => ({ id, reads: ['page.id'], writes: [], resources: [],
    execute: async page => ({ status: 'completed', page }) }));
}
