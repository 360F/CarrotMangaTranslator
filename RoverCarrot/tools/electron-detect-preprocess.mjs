// Developer comparison tool, run with an existing reference Electron executable:
// electron <this-script> <original-image> <new-evidence-directory>
// It does not participate in the RoverCMT runtime or load a detector/model.
import { app, nativeImage } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Expected original image and new evidence directory');
const output = resolve(destination);
mkdirSync(output); // Preserve earlier evidence.
app.setPath('userData', join(output, 'electron-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error('Reference image could not be decoded');
  const resized = image.resize({ width: 1152, height: 1152, quality: 'best' });
  const bitmap = resized.toBitmap(), pixels = 1152 * 1152;
  const chw = new Float32Array(pixels * 3);
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let p = 0; p < pixels; p++) for (let c = 0; c < 3; c++)
    chw[c * pixels + p] = (bitmap[p * 4 + 2 - c] / 255 - mean[c]) / std[c];
  const bytes = Buffer.from(chw.buffer);
  writeFileSync(join(output, 'electron-chw.bin'), bytes);
  writeFileSync(join(output, 'electron-preprocess.json'), JSON.stringify({ versions: process.versions,
    size: image.getSize(), resizedSize: resized.getSize(), tensorSha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
