import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDetection } from '../dist/detection/stage.js';
import { prepareOcr, applyOcr, ocrStage } from '../dist/ocr/stage.js';
import { normalizeHayai, sanitizeOcrTextForPrompt } from '../dist/ocr/normalization.js';
import { runPython, ocrTimeout, ocrCpuThreadEnv } from '../dist/adapters/hayai.js';
const page = () => applyDetection({ id: 'p', name: 'p', imagePath: '/p.png', width: 1000, height: 1000,
  blocks: [], analysisStatus: 'idle', createdAt: '', updatedAt: '' }, { width: 1000, height: 1000,
  dialogueRegions: [{ id: 1, regionId: 'd', bbox: [100,100,200,400], detectorConfidence: .9 }], effectRegions: [] });
const hint = (extra = {}) => ({ id: 1, x1: 100, y1: 100, x2: 200, y2: 400, ocrText: '本文', ...extra });
test('OCR keeps targets, clipping, geometry reuse, missing result and revision guards', () => {
  const p = page(); const origin = p.blocks[0].workflowOrigin;
  origin.ocrSubdivision = { mode: 'retry', bboxes: [[99,100,150,401],[150,100,201,401]] };
  const prep = prepareOcr(p);
  assert.deepEqual(prep.manifest.dialogueRegions[0].ocrSubdivision.bboxes, [[100,100,150,400],[150,100,200,400]]);
  assert.throws(() => applyOcr(p, prep, []), /missing its OCR/);
  for (const mutate of [q => q.id = 'changed', q => q.blocks[0].sourceText = 'changed', q => q.blocks[0].confidence = .1]) {
    const q = structuredClone(p); mutate(q); assert.throws(() => applyOcr(q, prep, [hint()]), /page changed/);
  }
  const badKey = { ...prep, inputKey: 'bad' }; assert.throws(() => applyOcr(p, badKey, [hint()]), /page changed/);
  p.blocks[0].bbox.x++;
  assert.equal(prepareOcr(p).manifest.dialogueRegions[0].ocrSubdivision, undefined);
  p.blocks[0].sourceText = 'saved'; assert.equal(prepareOcr(p), null); assert.ok(prepareOcr(p, true));
});
test('failed OCR persists partial evidence; recovered OCR clears failure and stores segments', () => {
  const p = page(); const prep = prepareOcr(p);
  const failed = applyOcr(p, prep, [hint({ ocrHealth: { status: 'failed', strategy: 'retry-subdivision' } })]);
  assert.equal(failed.status, 'failed'); assert.equal(failed.page.blocks[0].sourceText, '');
  assert.deepEqual(failed.page.blocks[0].workflowOrigin.ocrFailure, { reason: 'generation-budget-exhausted', strategy: 'retry-subdivision', rawText: '本文' });
  const segments = [{ x1: 100,y1: 100,x2: 150,y2: 400,ocrText: '本' }, { x1:150,y1:100,x2:200,y2:400,ocrText:'文' }];
  const recovered = applyOcr(failed.page, prepareOcr(failed.page), [hint({ recognitionSegments: segments, ocrHealth: { status: 'recovered' } })]);
  assert.equal(recovered.status, 'completed'); assert.equal(recovered.page.blocks[0].sourceText, '本文');
  assert.equal(recovered.page.blocks[0].workflowOrigin.ocrFailure, undefined);
  assert.deepEqual(recovered.page.blocks[0].workflowOrigin.recognitionSegments, segments);
});
test('normalization preserves reference truncation suffix, Japanese noise and 80 cap', () => {
  assert.equal(sanitizeOcrTextForPrompt('本文 abc'), '本文');
  assert.equal(sanitizeOcrTextForPrompt('a'.repeat(161), { sourceLanguage: 'en' }), 'a'.repeat(160) + '... [truncated 1 chars]');
  const items = Array.from({ length: 81 }, (_, i) => ({ ...hint(), id:i+1,label:'text',reviewFragmentId:`B${String(i+1).padStart(4,'0')}`,reviewStatus:'confirmed',reviewOrder:1,geometryLocked:true }));
  const hints = normalizeHayai({items},1000,1000); assert.equal(hints.length,80);
  assert.equal(hints[79].id,80);
});
test('batch loads once, binds in page order and waits for reader completion', async () => {
  const p = page(), q = page(); q.id = 'q'; let calls=0, done=false;
  const stage = ocrStage(async inputs => { calls++; assert.equal(inputs.length,2); await new Promise(r => setTimeout(r,5)); done=true; return inputs.map(() => [hint()]); });
  await stage.prepare([p,q]); assert.equal(done,true); assert.equal(calls,1);
  assert.equal((await stage.execute(p)).page.blocks[0].sourceText,'本文');
  assert.equal((await stage.execute(q)).page.blocks[0].sourceText,'本文'); assert.equal(calls,1);
});
test('worker timeout rejects only after process closes, with reference default timeout', async () => {
  assert.equal(ocrTimeout(1),3600000); assert.equal(ocrTimeout(13),3900000);
  await assert.rejects(runPython(process.execPath,['-e','setInterval(() => {}, 1000)'],process.env,30),/timed out/);
  await assert.rejects(runPython(process.execPath,['-e','process.exit(7)'],process.env,1000),/exited 7/);
});
test('failed OCR page commits evidence and skips later stage while another page proceeds', async () => {
  const { executePipeline } = await import('../dist/pipeline/run.js');
  const p=page(), q=page(); q.id='q';
  const stage=ocrStage(async inputs => inputs.map(input => [hint(input.pageId==='p' ? {ocrHealth:{status:'failed',strategy:'none'}} : {})]));
  const visited=[], committed=[];
  const result={runId:'run',mode:'smoke',status:'completed',output:'/unused',issues:[],events:[]};
  await executePipeline({id:'c',pages:[p,q]}, [stage,{id:'translate',reads:['sourceText'],writes:[],resources:[],async execute(p){visited.push(p.id);return {status:'completed',page:p};}}],
    {async commit(c){committed.push(structuredClone(c));},async finish(){}},result,()=>{});
  assert.equal(result.status,'partial');assert.deepEqual(visited,['q']);
  assert.equal(committed[0].pages[0].blocks[0].sourceText,'');
  assert.equal(committed[0].pages[0].blocks[0].workflowOrigin.ocrFailure.reason,'generation-budget-exhausted');
});
test('OCR config rejects unknown fields and relative runtime paths', async () => {
  const { resolveConfig }=await import('../dist/core/config.js');
  const config={version:1,mode:'smoke',input:'in',output:'out',stages:['ocr']};
  assert.throws(()=>resolveConfig({...config,ocr:{unknown:true}}),/Unknown OCR/);
  assert.throws(()=>resolveConfig({...config,ocr:{python:'python',hfCache:'/cache',device:'cpu',sourceLanguage:'ja'}}),/absolute path/);
  assert.throws(()=>resolveConfig({...config,ocr:{python:'/python',hfCache:'/cache',device:'rocm',sourceLanguage:'ja'}}),/device/);
});

test('Hayai thread environment applies the five reference defaults only on CPU', () => {
  assert.deepEqual(ocrCpuThreadEnv('cpu'), {
    MKL_NUM_THREADS: '2', NUMEXPR_NUM_THREADS: '2', OMP_NUM_THREADS: '2',
    OPENBLAS_NUM_THREADS: '2', VECLIB_MAXIMUM_THREADS: '2',
  });
  assert.deepEqual(ocrCpuThreadEnv('gpu'), {});
  assert.deepEqual(ocrCpuThreadEnv('gpu:0'), {});
});
