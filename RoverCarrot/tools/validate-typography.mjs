// CPU differential oracle: source functions execute read-only, on identical inputs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { bubbleLayoutRunner } from '../dist/adapters/bubble-layout.mjs';
import { createReference, reference } from '../tests/typography-reference.mjs';
import { defaultPlan, applyTypography } from '../dist/typography/typography.mjs';
import { workflowOverlayItems } from '../dist/typography/ported/main/pageWorkflow/pageWorkflowTypographyInput.mjs';
import { estimatePageSourceFontSizes } from '../dist/typography/ported/main/pipeline/sourceFontSizeEstimator.mjs';
import { processDetectedBubbleLayouts } from '../dist/typography/ported/main/bubbleLayout/bubbleLayoutPageProcessor.mjs';
import { runBubbleLayoutPostprocess } from '../dist/typography/ported/main/inpainting/bubbleLayoutRunner.mjs';
import { loadTypographyRaster } from '../dist/adapters/typography-raster.mjs';
import { koharuRuntime, prepareImage } from '../dist/adapters/koharu.js';
import { parseKoharuLayoutOutputs } from '../dist/detection/outputs.js';
const [contextFile, model, destination, electronDir] = process.argv.slice(2);
if (!destination || !model || !contextFile) throw new Error('Usage: node tools/validate-typography.mjs <OCR-context.json> <Koharu-model> <new-evidence-dir>');
const root=resolve(destination);await mkdir(root); // never overwrite earlier evidence
const context=JSON.parse(await readFile(contextFile,'utf8'));
const bytes=await readFile(context.bindings[0].chapter), chapter=JSON.parse(bytes);
const original=structuredClone(chapter), plan={...defaultPlan,overwrite:['typography','layout']};
const windowsPath=path=> /^[a-z]:/i.test(path) ? `/mnt/${path[0].toLowerCase()}${path.slice(2).replace(/\\+/g,'/')}` : path;
const fields=['fontSizePx','fontSizeIntent','sourceFontFacePx','sourceFontSizeConfidence','sourceFontSizeMethod','autoFitText','bubbleLayout','renderBbox','renderBboxSpace'];
const differences=[], measurements=[], identities=[], runtimeReferenceDifferences=[];
const electron = electronDir ? JSON.parse(await readFile(join(electronDir,'reference.json'),'utf8')) : undefined;
const digest=data=>createHash('sha256').update(data).digest('hex');
for(const page of chapter.pages) {
  if(!page.blocks.length)continue;
  const stored=original.pages.find(p=>p.id===page.id);
  const path=windowsPath(page.imagePath), raster=await loadTypographyRaster({...page,imagePath:path});
  identities.push({pageId:page.id,path,sha256:digest(await readFile(path)),width:raster.width,height:raster.height,bgraSha256:digest(raster.bgra)});
  // Fixed fresh input: retain source/translation/geometry/formatting and origin,
  // remove prior source estimates/intent so old results cannot masquerade as fresh.
  page.blocks=page.blocks.map(b=>{const next={...b};for(const k of ['sourceFontFacePx','sourceFontSizeConfidence','sourceFontSizeMethod','fontSizeIntent'])delete next[k];return next;});
  const items=workflowOverlayItems(page), refItems=reference('src/main/pageWorkflow/pageWorkflowTypographyInput.ts').workflowOverlayItems(page);
  assert.deepEqual(items,refItems);
  const loadRaster=async()=>raster;
  const estimates=await estimatePageSourceFontSizes({enabled:true,items,page,loadRaster});
  assert.deepEqual(estimates,await reference('src/main/pipeline/sourceFontSizeEstimator.ts').estimatePageSourceFontSizes({enabled:true,items:refItems,page,loadRaster}));
  const result={...page,blocks:page.blocks.map((b,i)=>estimates[i]?reference('src/main/pipeline/overlayFontSize.ts').applySizeOptions(b,undefined,{sourceFontSize:estimates[i],fontSizeAutoFit:true}):b)};
  const expected=reference('src/main/pageWorkflow/pageWorkflowTypographyMerge.ts').mergeWorkflowTypography(page,result,plan);
  const actual=await applyTypography(page,loadRaster,plan);assert.deepEqual(actual,expected);
  if (electron) {
    const expected = electron.identities.find(p => p.pageId === page.id);
    assert.ok(expected, 'Reference Electron raster page binding');
    if (expected.bgraSha256 !== digest(raster.bgra)) runtimeReferenceDifferences.push({pageId:page.id,kind:'raster',rover:digest(raster.bgra),reference:expected.bgraSha256});
    // JSON cannot retain array undefined; compare the exact serialized field contract.
    try { assert.deepEqual(JSON.parse(JSON.stringify(estimates)), expected.estimates); }
    catch { runtimeReferenceDifferences.push({pageId:page.id,kind:'estimates',rover:estimates,reference:expected.estimates}); }
  }
  measurements.push({pageId:page.id,items:items.length,measured:estimates.filter(Boolean).length,estimates});
  Object.assign(page,actual);
  for(const b of page.blocks)for(const key of fields.slice(0,6)){
    const old=stored.blocks.find(s=>s.id===b.id);
    try{assert.equal(Object.hasOwn(b,key),Object.hasOwn(old,key));assert.deepEqual(b[key],old[key]);}catch{differences.push({kind:'stored-typography',pageId:page.id,blockId:b.id,key,freshPresent:Object.hasOwn(b,key),storedPresent:Object.hasOwn(old,key),fresh:b[key],stored:old[key]});}
  }
}
const runtime=koharuRuntime(model), layouts=[];
try{
  const layoutIds=new Set([...context.bindings.map(b=>b.pageId),...original.pages.filter(p=>p.blocks.some(b=>b.bubbleLayout)).map(p=>p.id)]);
  for(const page of chapter.pages.filter(p=>layoutIds.has(p.id))){
    const mapped={...page,imagePath:windowsPath(page.imagePath)};delete mapped.inpaintedImagePath;
    const prepared=await prepareImage(mapped.imagePath), outputs=await runtime.infer(prepared);
    if (electronDir) {
      const refChw = await readFile(join(electronDir, `${page.id}.chw`));
      const ownChw = Buffer.from(prepared.data.buffer);
      if (!ownChw.equals(refChw)) runtimeReferenceDifferences.push({pageId:page.id,kind:'detector-input',rover:digest(ownChw),reference:digest(refChw)});
    }
    const detections=parseKoharuLayoutOutputs(outputs,prepared);
    const refDetections=reference('src/main/bubbleLayout/outputs.ts').parseKoharuLayoutOutputs(outputs,prepared);
    assert.deepEqual(detections,refDetections);
    const options={page:mapped,imageWidth:prepared.width,imageHeight:prepared.height,detections,policy:'balanced',pageRevision:`fixed:${digest(await readFile(mapped.imagePath))}`};
    const patches=processDetectedBubbleLayouts(options);
    assert.deepEqual(patches,reference('src/main/bubbleLayout/bubbleLayoutPageProcessor.ts').processDetectedBubbleLayouts({...options,detections:refDetections}));
    const args={page:mapped,runner:{async runPage(){return {patches};}},signal:new AbortController().signal,blockIds:page.blocks.map(b=>b.id),config:{policy:'balanced',overwriteManual:true}};
    const actual=await runBubbleLayoutPostprocess(args);
    assert.deepEqual(actual,await reference('src/main/inpainting/bubbleLayoutRunner.ts').runBubbleLayoutPostprocess(args));
    const detect=async()=>({imageWidth:prepared.width,imageHeight:prepared.height,detections});
    const refFacade=createReference({
      'src/main/logger.ts': {logWarn() {}},
      'src/main/bubbleLayout/assets.ts': {async ensureKoharuLayoutAssets(){return {modelPath:model};}},
      'src/main/bubbleLayout/detector.ts': {detectKoharuPageLayout:detect},
    })('src/main/bubbleLayout/bubbleLayoutFacade.ts');
    const realArgs={...args,runner:bubbleLayoutRunner(detect)};
    const realActual=await runBubbleLayoutPostprocess(realArgs);
    assert.deepEqual(realActual,await reference('src/main/inpainting/bubbleLayoutRunner.ts').runBubbleLayoutPostprocess({...realArgs,runner:refFacade.createProductionBubbleLayoutRunner({dataRoot:'unused'})}));
    layouts.push({pageId:page.id,detections:detections.length,patches,referenceExact:true});
    const stored=original.pages.find(p=>p.id===page.id);
    for(const b of actual.page.blocks)for(const key of fields.slice(6)){
      const old=stored.blocks.find(s=>s.id===b.id);
      try{assert.equal(Object.hasOwn(b,key),Object.hasOwn(old,key));assert.deepEqual(b[key],old[key]);}catch{differences.push({kind:'stored-layout',pageId:page.id,blockId:b.id,key,freshPresent:Object.hasOwn(b,key),storedPresent:Object.hasOwn(old,key),fresh:b[key],stored:old[key]});}
    }
    Object.assign(page,actual.page);
    console.log(`layout ${page.id}: ${patches.length} patches exact`);
  }
}finally{await runtime.close();}
await writeFile(join(root,'chapter.json'),JSON.stringify(chapter,null,2));
// Compare the persisted contract separately from own-property/undefined memory
// differences; retain both exact inventories without tolerance or key omission.
const persisted=JSON.parse(JSON.stringify(chapter)), persistedDifferences=[];
const layoutIds=new Set(layouts.map(p=>p.pageId));
for(const p of persisted.pages){const oldPage=original.pages.find(o=>o.id===p.id);for(const b of p.blocks){
  const old=oldPage.blocks.find(o=>o.id===b.id);
  for(const key of [...fields.slice(0,6),...(layoutIds.has(p.id)?fields.slice(6):[])]){
    try{assert.equal(Object.hasOwn(b,key),Object.hasOwn(old,key));assert.deepEqual(b[key],old[key]);}
    catch{persistedDifferences.push({pageId:p.id,blockId:b.id,key,freshPresent:Object.hasOwn(b,key),storedPresent:Object.hasOwn(old,key),fresh:b[key],stored:old[key]});}
  }
}}
await writeFile(join(root,'comparison.json'),JSON.stringify({reference:'fd461737 read-only TS executed in memory',chapter:{path:context.bindings[0].chapter,sha256:digest(bytes)},plan,identities,measurements,layouts,differences,persistedDifferences,runtimeReferenceDifferences,
  limitations:['Source estimator compared on identical sharp-decoded raster, not Electron decoder parity.', 'Stored chapter historical typography input, provider and raster decoder are not fully recorded.', 'Stored layout inference and historical prepass/erase/padding inputs are unbound; fixed revision is deliberately new. No tolerance or difference acceptance.']},null,2));
console.log(JSON.stringify({pages:measurements.length,blocks:measurements.reduce((n,p)=>n+p.items,0),measured:measurements.reduce((n,p)=>n+p.measured,0),layoutPages:layouts.length,storedDifferences:differences.length,persistedDifferences:persistedDifferences.length,referenceExact:true,runtimeReferenceDifferences:runtimeReferenceDifferences.length}));
if(runtimeReferenceDifferences.length) process.exitCode=1;
