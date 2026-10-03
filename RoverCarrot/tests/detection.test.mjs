import { assertPersistedDetection } from './persisted-detection.mjs';
import { compareManifests, summarizeComparison } from '../dist/detection/comparison.js';
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
import { detectionStage, applyDetection, normalized } from '../dist/detection/stage.js';
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

test('existing-block skip and empty detection rerun; internal overwrite replaces blocks and stale receipts',async()=>{
  let calls=0;const detect=async()=>{calls++;return manifest;};
  const first=(await detectionStage(detect).execute(page)).page;
  assert.strictEqual((await detectionStage(detect).execute(first)).page,first);assert.equal(calls,1);
  const overwritten=(await detectionStage(detect,{overwrite:true}).execute({...first,translationCompletion:{}})).page;
  assert.equal(calls,2);assert.notEqual(overwritten.blocks[0].id,first.blocks[0].id);assert.equal(overwritten.translationCompletion,undefined);
  const empty=async()=>{calls++;return {...manifest,dialogueRegions:[],effectRegions:[]};};
  const outcome=await detectionStage(empty).execute(page);assert.equal(outcome.status,'empty');
  const before=calls;await detectionStage(empty).execute(outcome.page);assert.equal(calls,before+1);assert.ok(!('pageWorkflow' in outcome.page));
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

test('models config treats blank as unset and accepts only absolute nonempty path; native model identity rejects missing, filename, size and hash',async t=>{
  const text=await fixtureText('config.toml');
  assert.equal(parseConfigToml(text+'\n[models]\nkoharu = ""\n','/w').models,undefined);
  for(const value of ['relative/model.onnx'])assert.throws(()=>parseConfigToml(text+`\n[models]\nkoharu = "${value}"\n`,'/w'),/absolute/);
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

// Electron 43.3.0 RESIZE_BEST reference (historical metadata lacks platform).
// Independent review confirmed the tracked 3x2 RGB PNG tensor with a Linux control.
// Regenerate with tools/electron-detect-preprocess.mjs; no model or Electron
// dependency is needed to run this characterization in a fresh Linux clone.
test('portable resize keeps the exact Electron RGB/CHW reference tensor for synthetic raster', async () => {
  const image = await prepareImage(new URL('./fixtures/page.png', import.meta.url).pathname);
  assert.equal(createHash('sha256').update(new Uint8Array(image.data.buffer)).digest('hex'),
    'cb62ba6ec5bcec2be808b280ffd5bb65402cdf007f6942b334280ecfad3c8fa8');
});

test('persisted chapter keeps strict-compatible blocks, defaults, subdivision and effect review', async t => {
  const root = await tempRoot(t, (await fixtureText('config.toml')).replace(/stages = .*/, 'stages = ["detect"]'));
  const image = join(root, 'page.png'), output = join(root, 'output');
  await sharp({create:{width:1152,height:1152,channels:3,background:'white'}}).png().toFile(image);
  const result = await cli({root, argv:['--input', image, '--output', output]});
  assert.equal(result.code, 0, result.out);
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const index = await json(join(output, 'index.json'));
  const workDir = join(output, 'works', index.workOrder[0]);
  const work = await json(join(workDir, 'work.json'));
  const chapter = await json(join(workDir, 'chapters', work.chapterOrder[0], 'chapter.json'));
  const stored = chapter.pages[0];
  assertPersistedDetection(stored);
  assert.equal(stored.blocks.length, 1);
  assert.deepEqual(stored.blocks[0].bbox, normalized(manifest.dialogueRegions[0].bbox, page));
  assert.equal(stored.blocks[0].confidence, manifest.dialogueRegions[0].detectorConfidence);
  assert.deepEqual(stored.blocks[0].workflowOrigin.ocrSubdivision, manifest.dialogueRegions[0].ocrSubdivision);
  assert.deepEqual(stored.soundEffectReview.regions[0], {id:manifest.effectRegions[0].regionId,
    bbox:normalized(manifest.effectRegions[0].bbox,page), detectorConfidence:manifest.effectRegions[0].detectorConfidence,
    sourceDetectionIds:manifest.effectRegions[0].sourceDetectionIds});
});

test('persisted-field check rejects keys outside the strict page and workflowOrigin sets', () => {
  const stored = JSON.parse(JSON.stringify(applyDetection(page, manifest)));
  assertPersistedDetection(stored);
  assert.throws(() => assertPersistedDetection({ ...stored, detectionDiagnostics: manifest.diagnostics }), /detectionDiagnostics/);
  const [block] = stored.blocks;
  const origin = { ...block.workflowOrigin, regionId: manifest.dialogueRegions[0].regionId };
  assert.throws(() => assertPersistedDetection({ ...stored, blocks: [{ ...block, workflowOrigin: origin }] }), /regionId/);
});

test('blank model is unset: production detect fails clearly, excluded detect runs without a model', async t => {
  const text = (await fixtureText('config.toml')) + '\n[models]\nkoharu = ""\n';
  const root = await tempRoot(t, text);
  const image = join(root, 'page.png');
  await writeFile(image, await readFile(new URL('./fixtures/page.png', import.meta.url)));
  const failed = await cli({root, runtime:null, argv:['--input',image,'--output',join(root,'detect')]});
  assert.equal(failed.code,1); assert.match(failed.out,/models.koharu.*absolute path/);
  await writeFile(join(root,'config','config.toml'), text.replace('"detect", ', ''));
  const config = parseConfigToml(await readFile(join(root,'config','config.toml'),'utf8'),root);
  assert.ok(!config.stages.includes('detect')); assert.equal(config.models,undefined);
  const passed = await cli({root, runtime:null, argv:['--input',image,'--output',join(root,'no-detect')]});
  assert.equal(passed.code,0,passed.out); assert.ok(!passed.out.includes('Detect'));
});

test('normalized bbox follows reference divide-then-scale, finite clamp and right/bottom edges', () => {
  assert.deepEqual(normalized([100,100,101,101],{width:100,height:100}),{x:999,y:999,w:1,h:1});
  assert.deepEqual(normalized([99.95,99.95,120,120],{width:100,height:100}),{x:999,y:999,w:1,h:1});
  assert.deepEqual(normalized([-1,-1,2,2],{width:100,height:100}),{x:0,y:0,w:30,h:30});
  assert.deepEqual(normalized([NaN,Infinity,NaN,Infinity],{width:100,height:100}),{x:0,y:0,w:1,h:1});
  const size={width:1280,height:1791}, box=[33.75,40.5,101.25,94.5];
  assert.deepEqual(normalized(box,size),{x:(box[0]/1280)*1000,y:(box[1]/1791)*1000,
    w:((box[2]-box[0])/1280)*1000,h:((box[3]-box[1])/1791)*1000});
});

test('validator compares type, geometric order, provenance and subdivision independently', () => {
  const original={...manifest,dialogueRegions:[{...manifest.dialogueRegions[0],bbox:[0,0,20,20]},
    {...manifest.dialogueRegions[0],bbox:[100,0,120,20],sourceDetectionIds:['T002']}]};
  assert.ok(compareManifests(original,structuredClone(original)).sameOrder);
  const changed=structuredClone(original);changed.dialogueRegions[0].sourceDetectionIds=['T999'];
  let result=compareManifests(original,changed);
  assert.ok(result.sameOrder && result.sameType && result.sameSubdivision);assert.equal(result.sameProvenance,false);
  changed.dialogueRegions.reverse();result=compareManifests(original,changed);assert.equal(result.sameOrder,false);
  const residual=structuredClone(original);residual.dialogueRegions[0].bbox[2]+=4.5;
  assert.ok(compareManifests(original,residual).sameOrder);
  residual.dialogueRegions[0].kind='effect';assert.equal(compareManifests(original,residual).sameType,false);
  const subdivision=structuredClone(original);delete subdivision.dialogueRegions[0].ocrSubdivision;
  assert.equal(compareManifests(original,subdivision).sameSubdivision,false);
  const missing=structuredClone(original);missing.dialogueRegions.pop();assert.equal(compareManifests(original,missing).sameOrder,false);
  const ambiguous=structuredClone(original);ambiguous.dialogueRegions[1].bbox=ambiguous.dialogueRegions[0].bbox;
  assert.equal(compareManifests(original,ambiguous).sameOrder,false);
});

test('validator summary shows provenance/subdivision as informational; only count/type/order gate status', () => {
  const original = {...manifest, dialogueRegions: [{...manifest.dialogueRegions[0], bbox: [0,0,20,20]},
    {...manifest.dialogueRegions[0], bbox: [100,0,120,20], sourceDetectionIds: ['T002']}]};
  const same = summarizeComparison(original, structuredClone(original));
  assert.equal(same.status, 'IN_PROGRESS');
  assert.deepEqual(same.lines.map(line => line.split(' ')[0]), ['count', 'type', 'order', 'provenance', 'subdivision']);
  assert.equal(same.lines[0], 'count       same — status gate (dialogue/effect: reference 2/1, actual 2/1)');
  assert.ok(same.lines.every(line => /^\S+ +same — /.test(line)));
  const provenance = structuredClone(original); provenance.dialogueRegions[0].sourceDetectionIds = ['T999'];
  const subdivision = structuredClone(original); delete subdivision.dialogueRegions[0].ocrSubdivision;
  for (const [changed, name] of [[provenance, 'provenance'], [subdivision, 'subdivision']]) {
    const result = summarizeComparison(original, changed);
    assert.equal(result.status, 'IN_PROGRESS', name);
    assert.deepEqual(result.lines.filter(line => line.includes('MISMATCH')), [`${name.padEnd(12)}MISMATCH — informational, status unchanged`]);
  }
  const count = structuredClone(original); count.dialogueRegions.pop();
  const type = structuredClone(original); type.dialogueRegions[0].kind = 'effect';
  const order = structuredClone(original); order.dialogueRegions.reverse();
  for (const [changed, name] of [[count, 'count'], [type, 'type'], [order, 'order']]) {
    const result = summarizeComparison(original, changed);
    assert.equal(result.status, 'BLOCKED', name);
    assert.match(result.lines.find(line => line.startsWith(name)), /MISMATCH — status gate/);
  }
});
