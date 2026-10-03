// Adapted from Chromium skia/ext/image_operations.cc and convolver.cc.
// Copyright 2012 The Chromium Authors. BSD-3-Clause; see THIRD_PARTY_NOTICES.md.
// Preserve the RESIZE_BEST software path: float32 Lanczos3 filters, 14-bit
// fixed coefficients, residual at the middle tap and truncation after each pass.
const f = Math.fround;
type Filter = { begin: number; fixed: number[] };

function filters(size: number, dest: number): Filter[] {
  const scale = f(dest / size), clamped = Math.min(1, scale);
  const support = f(3 / clamped), inverse = f(1 / scale);
  return Array.from({ length: dest }, (_, i) => {
    const center = f(f(i + 0.5) * inverse);
    const begin = Math.max(0, Math.floor(f(center - support)));
    const end = Math.min(size - 1, Math.ceil(f(center + support)));
    const values: number[] = [];
    let sum = 0;
    for (let j = begin; j <= end; j++) {
      const x = f(f(f(j + 0.5) - center) * clamped);
      let value = 0;
      if (x > -3 && x < 3) {
        if (Math.abs(x) < 1.1920928955078125e-7) value = 1;
        else {
          const pi = f(x * f(Math.PI)), third = f(pi / 3);
          value = f(f(f(Math.sin(pi)) / pi) * f(Math.sin(third)) / third);
        }
      }
      values.push(value);
      sum = f(sum + value);
    }
    const fixed = values.map(value => Math.trunc(f(f(value / sum) * 16384)));
    const middle = Math.floor(fixed.length / 2);
    fixed[middle] = fixed[middle]! + 16384 - fixed.reduce((a, b) => a + b, 0);
    return { begin, fixed };
  });
}

export function resizeDetectorRgb(data: Uint8Array, width: number, height: number, dest = 1152, destHeight = dest): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 3)
    throw new Error('Detection resize requires a complete RGB raster');
  const xFilters = filters(width, dest), yFilters = filters(height, destHeight);
  const intermediate = new Uint8Array(dest * height * 3);
  const result = new Uint8Array(dest * destHeight * 3);
  const quantize = (sum: number) => Math.max(0, Math.min(255, sum >> 14));
  for (let y = 0; y < height; y++) for (let x = 0; x < dest; x++) for (let c = 0; c < 3; c++) {
    const filter = xFilters[x]!;
    let sum = 0;
    for (let k = 0; k < filter.fixed.length; k++) sum += filter.fixed[k]! * data[(y * width + filter.begin + k) * 3 + c]!;
    intermediate[(y * dest + x) * 3 + c] = quantize(sum);
  }
  for (let y = 0; y < destHeight; y++) for (let x = 0; x < dest; x++) for (let c = 0; c < 3; c++) {
    const filter = yFilters[y]!;
    let sum = 0;
    for (let k = 0; k < filter.fixed.length; k++) sum += filter.fixed[k]! * intermediate[((filter.begin + k) * dest + x) * 3 + c]!;
    result[(y * dest + x) * 3 + c] = quantize(sum);
  }
  return result;
}
