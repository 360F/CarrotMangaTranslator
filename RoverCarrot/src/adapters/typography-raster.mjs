import sharp from 'sharp';
export async function loadTypographyRaster(page, signal) {
  signal?.throwIfAborted();
  const {data, info} = await sharp(page.imagePath, { failOn: 'warning', limitInputPixels: 120_000_000 })
    .toColourspace('srgb').flatten({ background: '#000000' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bgra = Uint8Array.from(data);
  for (let i = 0; i < bgra.length; i += 4) { bgra[i] = data[i + 2]; bgra[i + 2] = data[i]; }
  signal?.throwIfAborted();
  return {width: info.width, height: info.height, bgra};
}
