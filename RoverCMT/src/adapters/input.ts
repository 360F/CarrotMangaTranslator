import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';

const formats: Record<string, string> = {
  '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.jfif': 'jpeg', '.webp': 'webp',
};

export function supportsImage(path: string): boolean {
  return Object.hasOwn(formats, extname(path).toLowerCase());
}

// External input is validated before persistence publishes any normalized pages.
// Keep the validated bytes so a changed source cannot invalidate the stored copy.
export async function materializeImages(paths: string[]) {
  const images = [];
  for (const path of paths) {
    const extension = extname(path).toLowerCase();
    if (!supportsImage(path)) throw new Error(`Unsupported image extension: ${path}`);
    try {
      const bytes = await readFile(path);
      const image = sharp(bytes, { failOn: 'warning' });
      const metadata = await image.metadata();
      if (metadata.format !== formats[extension]) throw new Error('Image format does not match extension');
      if (!metadata.width || !metadata.height || metadata.width > 100000 || metadata.height > 100000)
        throw new Error('Invalid image dimensions');
      if ((metadata.pages ?? 1) !== 1) throw new Error('Animated images are not supported in Step 1');
      // metadata alone does not validate compressed pixel data; force full decode.
      await image.raw().toBuffer();
      images.push({ path, bytes, width: metadata.width, height: metadata.height,
        extension: extension === '.jfif' ? '.jpg' : extension });
    } catch (error) {
      throw new Error(`Invalid image: ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return images;
}
