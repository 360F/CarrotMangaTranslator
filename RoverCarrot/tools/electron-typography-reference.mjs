// Run with an existing reference Electron, never the installed Carrot application.
// Executes the unmodified raster loader/estimator/preprocessor. No model inference.
import { app } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { reference } from '../tests/typography-reference.mjs';
const [contextPath, destination] = process.argv.slice(2);
if (!destination || !contextPath) throw new Error('Expected OCR context and new evidence directory');
const root=resolve(destination);await mkdir(root);
app.setPath('userData',join(root,'profile'));app.disableHardwareAcceleration();
await app.whenReady();
try {
  const context=JSON.parse(await readFile(contextPath,'utf8'));
  const chapter=JSON.parse(await readFile(context.bindings[0].chapter,'utf8'));
  const windowsPath=path=>/^[a-z]:/i.test(path)?`/mnt/${path[0].toLowerCase()}${path.slice(2).replace(/\\+/g,'/')}`:path;
  const {nativeImage}=await import('electron');
  const identities=[];
  const estimator=reference('src/main/pipeline/sourceFontSizeEstimator.ts');
  for(const page of chapter.pages.filter(p=>p.blocks.length)){
    const path=windowsPath(page.imagePath),mapped={...page,imagePath:path};
    const raster=await reference('src/main/fontMatchingPageImage.ts').loadFontMatchingPageRaster(mapped);
    const items=reference('src/main/pageWorkflow/pageWorkflowTypographyInput.ts').workflowOverlayItems(page);
    const estimates=await estimator.estimatePageSourceFontSizes({enabled:true,page,items,loadRaster:async()=>raster});
    const record={pageId:page.id,width:raster.width,height:raster.height,bgraSha256:createHash('sha256').update(raster.bgra).digest('hex'),estimates};
    await writeFile(join(root,`${page.id}.bgra`),raster.bgra);
    const prepared=reference('src/main/bubbleLayout/preprocess.ts').prepareComicDetectorImage(nativeImage.createFromPath(path));
    await writeFile(join(root,`${page.id}.chw`),Buffer.from(prepared.rgbChw.buffer));
    identities.push(record);
  }
  await writeFile(join(root,'reference.json'),JSON.stringify({versions:process.versions,platform:process.platform,identities},null,2));
  app.quit();
}catch(error){console.error(error);app.exit(1);}
