function getScaledSize(width, height, maxLongSide) {
  const longSide = Math.max(width, height);
  if (longSide <= 0 || longSide <= maxLongSide) {
    return { width, height };
  }

  const scale = maxLongSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
function enhanceBitmapBuffer(bitmap, contrast = 1, grayscale = false) {
  const output = Buffer.from(bitmap);
  const translation = ((1 - contrast) / 2) * 255;

  for (let offset = 0; offset < output.length; offset += 4) {
    const blue = output[offset];
    const green = output[offset + 1];
    const red = output[offset + 2];

    if (grayscale) {
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const adjusted = clampByte(luminance * contrast + translation);
      output[offset] = adjusted;
      output[offset + 1] = adjusted;
      output[offset + 2] = adjusted;
      continue;
    }

    output[offset] = clampByte(blue * contrast + translation);
    output[offset + 1] = clampByte(green * contrast + translation);
    output[offset + 2] = clampByte(red * contrast + translation);
  }

  return output;
}
export {getScaledSize,enhanceBitmapBuffer};
