import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOG_LIMITS = { 'rovercmt.log': 10 * 1024 * 1024, 'critical.log': 5 * 1024 * 1024 } as const;
type LogName = keyof typeof LOG_LIMITS;

// Keep the newest whole lines whose total size is <= maxBytes. No backup files are kept.
export function trimLogFile(path: string, maxBytes: number): void {
  if (!existsSync(path) || statSync(path).size <= maxBytes) return;
  const bytes = readFileSync(path);
  let start = bytes.length - maxBytes;
  // Never start mid-line: skip to the byte after the next newline.
  if (start > 0 && bytes[start - 1] !== 0x0a) {
    const newline = bytes.indexOf(0x0a, start);
    start = newline === -1 ? bytes.length : newline + 1;
  }
  const temporary = `${path}.trim`;
  writeFileSync(temporary, bytes.subarray(start));
  renameSync(temporary, path);
}

// Line-oriented JSONL logs under one directory: rovercmt.log (everything) and
// critical.log (problems the user must look at). Sync writes survive abrupt exits.
export class RunLog {
  private sizes = new Map<LogName, number>();
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    for (const name of Object.keys(LOG_LIMITS) as LogName[]) this.trim(name);
  }
  info(type: string, data: Record<string, unknown> = {}): void { this.write('rovercmt.log', 'info', type, data); }
  critical(type: string, data: Record<string, unknown> = {}): void {
    this.write('rovercmt.log', 'error', type, data);
    this.write('critical.log', 'error', type, data);
  }
  close(): void { for (const name of Object.keys(LOG_LIMITS) as LogName[]) this.trim(name); }
  private write(name: LogName, level: string, type: string, data: Record<string, unknown>): void {
    const line = JSON.stringify({ time: new Date().toISOString(), level, type, ...data }) + '\n';
    appendFileSync(join(this.dir, name), line);
    const size = (this.sizes.get(name) ?? 0) + Buffer.byteLength(line);
    this.sizes.set(name, size);
    // Trim with headroom so a long run does not rewrite the file on every line.
    if (size > LOG_LIMITS[name]) this.trim(name, Math.floor(LOG_LIMITS[name] * 0.8));
  }
  private trim(name: LogName, target: number = LOG_LIMITS[name]): void {
    const path = join(this.dir, name);
    trimLogFile(path, target);
    this.sizes.set(name, existsSync(path) ? statSync(path).size : 0);
  }
}
