import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist/ocr', { recursive: true });
for (const name of ['ocr-text', 'glossary-omission']) await copyFile(`src/ocr/${name}.mjs`, `dist/ocr/${name}.mjs`);
