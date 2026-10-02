import type { Event, StageId } from '../core/contracts.js';

const LABELS: Record<StageId, string> = {
  detect: 'Detect', ocr: 'OCR', 'source-rules': 'Source rules', translate: 'Translate',
  'translation-rules': 'Translation rules', typography: 'Typography', 'format-rules': 'Format rules',
  erase: 'Erase', layout: 'Layout', review: 'Review', render: 'Render',
};
const WIDTH = 20;

export function stageLabel(stage: StageId): string { return LABELS[stage]; }

type Row = { stage: StageId; done: number; started: boolean; failed: boolean; final?: 'PASS' | 'FAIL' | 'Skipped' };

// Observes pipeline events in the order they happen; it never drives execution.
// TTY: redraws the block in place with plain ANSI cursor-up/clear-line (no hidden
// cursor or raw mode, so nothing needs restoring). Non-TTY: one line per finished stage.
export class StageProgress {
  private rows: Row[];
  private total = 0;
  private drawn = 0;
  private printed = new Set<StageId>();
  constructor(stages: StageId[], private write: (text: string) => void,
    private tty: boolean, private unicode: boolean) {
    this.rows = stages.map(stage => ({ stage, done: 0, started: false, failed: false }));
  }
  start(totalPages: number): void { this.total = totalPages; this.render(); }
  event(event: Event): void {
    const row = this.rows.find(item => item.stage === event.stage);
    if (!row) return;
    if (event.type === 'stage-start') row.started = true;
    if (event.type === 'stage-end') {
      row.done += 1;
      if (event.status === 'failed') row.failed = true;
    }
    this.render();
  }
  // Settles every row. `running` is the stage left mid-flight by an infrastructure failure.
  finish(running?: StageId): StageId[] {
    for (const row of this.rows) {
      if (row.failed || row.stage === running) row.final = 'FAIL';
      else if (row.done === this.total) row.final = 'PASS';
      else row.final = 'Skipped';
    }
    this.render();
    return this.rows.filter(row => row.final === 'FAIL').map(row => row.stage);
  }
  // Stage that started but has not finished every page (used after an aborted run).
  inFlight(): StageId | undefined {
    return this.rows.find(row => row.started && row.done < this.total)?.stage;
  }
  private line(row: Row): string {
    const fraction = this.total ? row.done / this.total : 0;
    const filled = Math.round(fraction * WIDTH);
    const [on, off] = this.unicode ? ['█', '░'] : ['#', '-'];
    const complete = this.total > 0 && row.done === this.total;
    const status = row.final ?? (row.failed ? 'FAIL' : complete ? 'PASS' : row.started ? 'Processing' : 'Waiting');
    return `${stageLabel(row.stage).padEnd(18)}${`${Math.floor(fraction * 100)}%`.padStart(4)} ` +
      `[${on.repeat(filled)}${off.repeat(WIDTH - filled)}] ${status}`;
  }
  private render(): void {
    if (this.tty) {
      const up = this.drawn ? `\x1b[${this.drawn}A` : '';
      this.write(up + this.rows.map(row => `\x1b[2K${this.line(row)}\n`).join(''));
      this.drawn = this.rows.length;
      return;
    }
    // Print each stage once, in order, as soon as it has handled every page or is settled.
    for (const row of this.rows) {
      if (this.printed.has(row.stage)) continue;
      if (!row.final && !(this.total > 0 && row.done === this.total)) break;
      this.printed.add(row.stage);
      this.write(this.line(row) + '\n');
    }
  }
}
