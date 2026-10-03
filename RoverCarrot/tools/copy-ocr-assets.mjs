import { copyFile, mkdir, cp } from 'node:fs/promises';
await mkdir('dist/ocr', { recursive: true });
for (const name of ['ocr-text', 'glossary-omission']) await copyFile(`src/ocr/${name}.mjs`, `dist/ocr/${name}.mjs`);

await cp('src/translation', 'dist/translation', { recursive: true, filter: path => !path.endsWith('.ts') });
for (const name of ['llama', 'translation-images', 'translation-store']) await copyFile(`src/adapters/${name}.mjs`, `dist/adapters/${name}.mjs`);

await cp('src/typography', 'dist/typography', { recursive: true, filter: path => !path.endsWith('.ts') });
await cp('src/layout', 'dist/layout', { recursive: true, filter: path => !path.endsWith('.ts') });
for (const name of ['typography-raster', 'bubble-layout']) await copyFile(`src/adapters/${name}.mjs`, `dist/adapters/${name}.mjs`);
