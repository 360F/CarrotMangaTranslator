import sharp from 'sharp';
import { resizeDetectorRgb } from './detection-resize.js';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { getScaledSize, enhanceBitmapBuffer } from '../translation/ported/image-math.mjs';
export async function pageImages(page, options) {
  const bytes = await readFile(page.imagePath);
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[extname(page.imagePath).toLowerCase()];
  if (!mime) throw new Error('Unsupported original image MIME');
  const original = { role: 'original', path: page.imagePath, width: page.width, height: page.height, mime,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  if (!options.includeEnhancedVariant) return [original];
  // Same bounded size and BGRA luminance/contrast math as the Electron source.
  // Reuse the existing Chromium RESIZE_BEST port for the bounded assist view.
  const { data: decoded, info } = await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = getScaledSize(info.width, info.height, 1900);
  const rgb = new Uint8Array(info.width * info.height * 3), alpha = new Uint8Array(rgb.length);
  for (let i = 0; i < info.width * info.height; i++) {
    rgb.set(decoded.subarray(i * 4, i * 4 + 3), i * 3);
    alpha.fill(decoded[i * 4 + 3], i * 3, i * 3 + 3);
  }
  const resized = resizeDetectorRgb(rgb, info.width, info.height, size.width, size.height);
  const resizedAlpha = resizeDetectorRgb(alpha, info.width, info.height, size.width, size.height);
  const data = Buffer.alloc(size.width * size.height * 4);
  for (let i = 0; i < size.width * size.height; i++) {
    data[i * 4] = resized[i * 3 + 2]; data[i * 4 + 1] = resized[i * 3 + 1];
    data[i * 4 + 2] = resized[i * 3]; data[i * 4 + 3] = resizedAlpha[i * 3];
  }
  const enhanced = enhanceBitmapBuffer(data, Math.max(1.6, options.enhancedContrast ?? 1.35), true);
  const png = await sharp(enhanced, { raw: { ...size, channels: 4 } }).png().toBuffer();
  const path = join(options.outputDir, 'input-enhanced.png'); await writeFile(path, png, { flag: 'wx' });
  return [original, { role: 'enhanced', path, ...size, mime: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}` }];
}
