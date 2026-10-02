import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { rawOutputs, fakeRuntime } from './fake-koharu.mjs';
import { prepareImage, checkModel } from '../dist/adapters/koharu.js';
import { parseKoharuLayoutOutputs } from '../dist/detection/outputs.js';
import { buildHayaiRegionManifest } from '../dist/detection/geometry.js';
import { detectionStage, applyDetection } from '../dist/detection/stage.js';
import { koharuDetectionStage } from '../dist/adapters/detection.js';
import { parseConfigToml } from '../dist/cli/config-file.js';
import { cli, tempRoot, logLines, runRecord, fixtureText } from './cli-helpers.mjs';

const page = { id:'p', name:'p.png', imagePath:'/p.png', width:1152, height:1152, blocks:[], analysisStatus:'idle',createdAt:'x',updatedAt:'x' };
const raw = rawOutputs();
const parsed = parseKoharuLayoutOutputs(raw, page);
const manifest = buildHayaiRegionManifest({imageWidth:page.width,imageHeight:page.height,detections:parsed});

test('raw outputs preserve class selection, fifth logit ignored, confidence ordering, bbox and malformed rejection', () => {
  assert.deepEqual(parsed.map(d=>d.label),['text','onomatopoeia','bubble','panel']);
  assert.ok(parsed.every(d=>d.mask.width===288 && d.mask.height===288 && d.score>.95));
  assert.ok(Math.abs(parsed[0].box[0]-144)<.001);
  const labels={...raw.labels,data:raw.labels.data.slice()}; labels.data.fill(-20,0,4); labels.data[4]=100;
  assert.equal(parseKoharuLayoutOutputs({...raw,labels},page).length,3);
  labels.data[0]=-1.2; // sigmoid .231 < text threshold .25
  assert.equal(parseKoharuLayoutOutputs({...raw,labels},page).length,3);
  labels.data[0]=-1; assert.equal(parseKoharuLayoutOutputs({...raw,labels},page).length,4);
  for(const [name,dims] of [['dets',[300,4]],['labels',[1,300,4]],['masks',[1,300,287,288]]])
    assert.throws(()=>parseKoharuLayoutOutputs({...raw,[name]:{...raw[name],dims}},page),/shape/);
  assert.throws(()=>parseKoharuLayoutOutputs({...raw,dets:{...raw.dets,data:[]}},page),/길이/);
  assert.throws(()=>parseKoharuLayoutOutputs({...raw,masks:undefined},page),/tensor/);
  const masks={...raw.masks,data:raw.masks.data.slice()};masks.data[0]=NaN;
  assert.throws(()=>parseKoharuLayoutOutputs({...raw,masks},page),/유한/);
});

test('production geometry separates dialogue/effect; subdivision keeps right-to-left crops and no recognitionBboxes', () => {
  assert.equal(manifest.dialogueRegions.length,1);assert.equal(manifest.effectRegions.length,1);
  const dialogue=manifest.dialogueRegions[0];
  assert.equal(dialogue.regionId,'D001');assert.deepEqual(dialogue.sourceDetectionIds,['T001']);
  assert.equal(dialogue.recognitionBboxes,undefined);
  assert.equal(dialogue.ocrSubdivision.bboxes.length,2);
  assert.ok(dialogue.ocrSubdivision.bboxes[0][0]>dialogue.ocrSubdivision.bboxes[1][0]);
  assert.ok(['retry','preemptive'].includes(dialogue.ocrSubdivision.mode));
  assert.equal(manifest.effectRegions[0].kind,'effect');
  const result=applyDetection(page,manifest);assert.equal(result.analysisStatus,'idle');
  assert.equal(result.blocks[0].sourceDirection,'horizontal');assert.equal(result.blocks[0].sourceText,'');
  assert.deepEqual(result.blockOrder,result.blocks.map(b=>b.id));
  assert.equal(result.soundEffectReview.regions.length,1);
  assert.ok(!JSON.stringify(result).includes('logits'));
  assert.deepEqual(result.blocks[0].workflowOrigin.ocrSubdivision,dialogue.ocrSubdivision);
});

test('existing-block and empty detection skip; internal overwrite replaces blocks and stale receipts',async()=>{
  let calls=0;const detect=async()=>{calls++;return manifest;};
  const first=(await detectionStage(detect).execute(page)).page;
  assert.strictEqual((await detectionStage(detect).execute(first)).page,first);assert.equal(calls,1);
  const overwritten=(await detectionStage(detect,{overwrite:true}).execute({...first,translationCompletion:{}})).page;
  assert.equal(calls,2);assert.notEqual(overwritten.blocks[0].id,first.blocks[0].id);assert.equal(overwritten.translationCompletion,undefined);
  const empty=async()=>{calls++;return {...manifest,dialogueRegions:[],effectRegions:[]};};
  const outcome=await detectionStage(empty).execute(page);assert.equal(outcome.status,'empty');
  const before=calls;await detectionStage(empty).execute(outcome.page);assert.equal(calls,before);
});

test('portable preprocessing is stretch RGB CHW normalized; grayscale and transparent alpha have explicit policy',async t=>{
  const root=await tempRoot(t);
  for(const [name,channels,pixels,expected] of [
    ['rgb',3,[255,128,0],[255,128,0]],['gray',1,[128],[128,128,128]],['alpha',4,[255,128,20,0],[0,0,0]],
  ]) {
    const file=join(root,`${name}.png`);
    await sharp(Buffer.from(pixels),{raw:{width:1,height:1,channels}}).png().toFile(file);
    const image=await prepareImage(file);assert.deepEqual(image.dims,[1,3,1152,1152]);
    assert.deepEqual([image.width,image.height],[1,1]);
    for(let c=0;c<3;c++)assert.ok(Math.abs(image.data[c*1152*1152]-(expected[c]/255-[.485,.456,.406][c])/[.229,.224,.225][c])<1e-5);
  }
  await assert.rejects(prepareImage(join(root,'missing.png')),/decode\/preprocessing/);
});

test('models config accepts only absolute nonempty path; native model identity rejects missing, filename, size and hash',async t=>{
  const text=await fixtureText('config.toml');
  for(const value of ['', 'relative/model.onnx'])assert.throws(()=>parseConfigToml(text+`\n[models]\nkoharu = "${value}"\n`,'/w'),/absolute/);
  assert.equal(parseConfigToml(text+'\n[models]\nkoharu = "/models/rfdetr-seg-2xlarge.onnx"\n','/w').models.koharu,'/models/rfdetr-seg-2xlarge.onnx');
  const root=await tempRoot(t);const model=join(root,'rfdetr-seg-2xlarge.onnx');
  await assert.rejects(checkModel(model),/not found/);
  await writeFile(model,'short');await assert.rejects(checkModel(model),/byte size mismatch/);
  const {open}=await import('node:fs/promises');const handle=await open(model,'w');await handle.truncate(148442003);await handle.close();
  await assert.rejects(checkModel(model),/SHA-256 mismatch/);
  await assert.rejects(checkModel(join(root,'other.onnx')),/filename/);
});

test('real detection failure reaches page persistence, progress, critical log, and skips downstream; missing config cannot silently use fake',async t=>{
  const root=await tempRoot(t,await fixtureText('config.toml'));const image=join(root,'page.png');
  await writeFile(image,await readFile(new URL('./fixtures/page.png',import.meta.url)));
  for(const [label,runtime] of [['runtime',{infer:async()=>{throw new Error('fixture inference failed');}}],['shape',{infer:async()=>({...raw,dets:{...raw.dets,dims:[3]}})}]]) {
    const output=join(root,label);const result=await cli({root,argv:['--input',image,'--output',output],runtime});
    assert.equal(result.code,1);assert.match(result.out,/Detect.*FAIL/);
    const record=await runRecord(output);assert.equal(record.status,'partial');assert.equal(record.events.filter(e=>e.type==='stage-start').length,1);
    assert.equal(record.issues[0].stage,'detect');
  }
  assert.ok((await logLines(root,'critical.log')).every(entry=>entry.stage==='detect'));
  // Explicit null disables helper fixture without introducing a public flag.
  const missing=await cli({root,argv:['--input',image,'--output',join(root,'missing')],runtime:null});
  assert.equal(missing.code,1);assert.match(missing.out,/models.koharu/);
  const bad=await koharuDetectionStage(fakeRuntime).execute({...page,imagePath:'/missing.png'}).catch(error=>error);
  assert.match(bad.message,/decode/);
});

// Windows Electron 43.3.0 RESIZE_BEST reference for the tracked 3x2 RGB PNG.
// Regenerate with tools/electron-detect-preprocess.mjs; no model or Electron
// dependency is needed to run this characterization in a fresh Linux clone.
test('portable resize keeps the exact Electron RGB/CHW reference tensor for synthetic raster', async () => {
  const image = await prepareImage(new URL('./fixtures/page.png', import.meta.url).pathname);
  assert.equal(createHash('sha256').update(new Uint8Array(image.data.buffer)).digest('hex'),
    'cb62ba6ec5bcec2be808b280ffd5bb65402cdf007f6942b334280ecfad3c8fa8');
});
