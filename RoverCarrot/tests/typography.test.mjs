import assert from 'node:assert/strict';
import test from 'node:test';
import { reference } from './typography-reference.mjs';
import { applyTypography, defaultPlan } from '../dist/typography/typography.mjs';
import { applyLayout } from '../dist/layout/layout.mjs';
import { workflowTypographyFields, workflowTargetBlocks } from '../dist/typography/ported/shared/pageWorkflowPolicy.mjs';
import { processDetectedBubbleLayouts } from '../dist/typography/ported/main/bubbleLayout/bubbleLayoutPageProcessor.mjs';
import { runBubbleLayoutPostprocess } from '../dist/typography/ported/main/inpainting/bubbleLayoutRunner.mjs';
import { workflowOverlayItems } from '../dist/typography/ported/main/pageWorkflow/pageWorkflowTypographyInput.mjs';
import { estimatePageSourceFontSizes } from '../dist/typography/ported/main/pipeline/sourceFontSizeEstimator.mjs';
const base = { id: 'b', bbox: {x:200,y:200,w:400,h:400}, bboxSpace:'normalized_1000', sourceText:'わ', translatedText:'번역입니다', fontSizePx:24,
  sourceDirection:'horizontal',renderDirection:'horizontal',workflowOrigin:{initialFontSize:24},autoFitText:true,outlineWidthPx:0 };
export const page = {id:'p', width:200,height:200,imagePath:'original.png', blocks:[base]};
export function raster() {
  const bgra = new Uint8Array(200*200*4).fill(255);
  for (let glyph=0;glyph<1;glyph++)for(let y=62;y<80;y++)for(let x=46+glyph*18;x<58+glyph*18;x++)
    for(let c=0;c<3;c++)bgra[(y*200+x)*4+c]=0;
  return {width:200,height:200,bgra};
}
export function detections() {
  const logits=new Float32Array(288*288).fill(-10);
  for(let y=0;y<288;y++)for(let x=0;x<288;x++)if(((x-144)/110)**2+((y-144)/105)**2<=1)logits[y*288+x]=10;
  return [{labelId:0,label:'bubble',box:[15,15,185,185],score:.99,mask:{logits,width:288,height:288}},
    {labelId:1,label:'text',box:[40,40,120,120],score:.98}];
}
test('source size and typography merge execute reference on identical raster/items',async()=>{
  const input=structuredClone(page), loadRaster=async()=>raster();
  const items=workflowOverlayItems(input), refItems=reference('src/main/pageWorkflow/pageWorkflowTypographyInput.ts').workflowOverlayItems(input);
  assert.deepEqual(items,refItems);
  const estimates=await estimatePageSourceFontSizes({enabled:true,page:input,items,loadRaster});
  assert.ok(estimates[0]);
  assert.deepEqual(estimates,await reference('src/main/pipeline/sourceFontSizeEstimator.ts').estimatePageSourceFontSizes({enabled:true,page:input,items:refItems,loadRaster}));
  const result={...input,blocks:input.blocks.map((b,i)=>reference('src/main/pipeline/overlayFontSize.ts').applySizeOptions(b,undefined,{sourceFontSize:estimates[i],fontSizeAutoFit:true}))};
  const expected=reference('src/main/pageWorkflow/pageWorkflowTypographyMerge.ts').mergeWorkflowTypography(input,result,defaultPlan);
  const actual=await applyTypography(input,loadRaster);
  assert.deepEqual(actual,expected);assert.equal(actual.blocks[0].fontSizeIntent,'source-match');assert.equal(actual.blocks[0].fontSizePx,24);
  assert.deepEqual(input,page);
});
test('typography overwrite/manual/origin/disabled and layout target selection match reference',()=>{
  const ref=reference('src/shared/pageWorkflowPolicy.ts');
  for(const b of [base,{...base,fontSizeIntent:'manual'},{...base,workflowOrigin:undefined},{...base,fontSizePx:30},{...base,workflowOrigin:{initialFontSize:24,sizeApplied:true}}])
    for(const plan of [defaultPlan,{...defaultPlan,autoSize:false},{...defaultPlan,overwrite:['typography','layout']}]){
      assert.deepEqual(workflowTypographyFields(b,plan),ref.workflowTypographyFields(b,plan));
      for(const stage of ['typography','layout'])assert.deepEqual(workflowTargetBlocks({...page,blocks:[b]},stage,plan),ref.workflowTargetBlocks({...page,blocks:[b]},stage,plan));
    }
});
test('bubble mask refinement/slots/renderBbox and patch application match reference exactly',async()=>{
  const options={page:structuredClone(page),imageWidth:200,imageHeight:200,detections:detections(),policy:'balanced',pageRevision:'fixed-revision'};
  const patches=processDetectedBubbleLayouts(options);
  assert.ok(patches.length);assert.ok(patches[0].bubbleLayout);assert.ok(patches[0].renderBbox);
  assert.deepEqual(patches,reference('src/main/bubbleLayout/bubbleLayoutPageProcessor.ts').processDetectedBubbleLayouts(structuredClone(options)));
  const args={page,runner:{async runPage(){return {patches};}},signal:new AbortController().signal,config:{policy:'balanced',overwriteManual:false}};
  assert.deepEqual(await runBubbleLayoutPostprocess(args),await reference('src/main/inpainting/bubbleLayoutRunner.ts').runBubbleLayoutPostprocess(args));
});
test('layout protects manual states and validates duplicate/malformed patches; required failure propagates',async()=>{
  const error=new Error('detector failed');
  await assert.rejects(applyLayout(page,{async runPage(){throw error;}}), e=>e===error);
  const blank = {...page, blocks:[{...base,translatedText:' '}]};
  assert.deepEqual(processDetectedBubbleLayouts({page:blank,imageWidth:200,imageHeight:200,detections:detections(),policy:'balanced',pageRevision:'fixed'}), []);
  let calls=0;
  const manual={...page,blocks:[{...base,bubbleLayout:{version:1,origin:'manual',direction:'horizontal',confidence:1,insetRatio:0,regions:[{spans:[{blockStart:0,blockEnd:1,inlineStart:0,inlineEnd:1}]}]}}]};
  assert.deepEqual(await applyLayout(manual,{async runPage(){calls++;return {patches:[]};}}),manual);assert.equal(calls,0);
  for (const patches of [[{blockId:'b'},{blockId:'b'}],[{blockId:'unknown'}],[{blockId:'b',renderBbox:{x:0,y:0,w:-1,h:1}}]])
    await assert.rejects(applyLayout(page,{async runPage(){return {patches};}}));
});
test('raster failure fails closed as reference; abort propagates',async()=>{
  const input=structuredClone(page), loadRaster=async()=>{throw new Error('decode failure');};
  const ref=await reference('src/main/pipeline/sourceFontSizeEstimator.ts').estimatePageSourceFontSizes({enabled:true,page:input,items:workflowOverlayItems(input),loadRaster});
  assert.deepEqual(ref,[]);
  assert.deepEqual(await applyTypography(input,loadRaster),reference('src/main/pageWorkflow/pageWorkflowTypographyMerge.ts').mergeWorkflowTypography(input,input,defaultPlan));
  const abort=new AbortController();abort.abort();await assert.rejects(applyTypography(page,async()=>raster(),defaultPlan,abort.signal));
});

test('shared balloon ownership and transient erase-prepass geometry exactly match reference',()=>{
  const input={...page,blocks:[{...base,id:'left',bbox:{x:200,y:300,w:250,h:300}},{...base,id:'right',bbox:{x:550,y:300,w:250,h:300}}]};
  for(const gap of [undefined,0]){
    const options={page:input,imageWidth:200,imageHeight:200,detections:detections(),policy:'balanced',pageRevision:'fixed',sharedOwnershipGapPx:gap};
    const actual=processDetectedBubbleLayouts(options);
    assert.deepEqual(actual,reference('src/main/bubbleLayout/bubbleLayoutPageProcessor.ts').processDetectedBubbleLayouts(structuredClone(options)));
    assert.equal(actual.length,2);
    if(gap===0)assert.ok(actual.every(p=>p.sharedInpaintGroupIds?.length));
  }
  for(const patch of [{translatedText:''},{curveLayout:{}},{inpaintExcluded:true}])assert.deepEqual(processDetectedBubbleLayouts({page:{...page,blocks:[{...base,...patch}]},imageWidth:200,imageHeight:200,detections:detections(),policy:'balanced',pageRevision:'fixed'}),[]);
});

test('manual layout is preserved with explicit target unless overwrite is requested; allowlist discards source edits',async()=>{
  const options={page,imageWidth:200,imageHeight:200,detections:detections(),policy:'balanced',pageRevision:'fixed'};
  const patch=processDetectedBubbleLayouts(options)[0];
  const manual={...page,blocks:[{...base,bubbleLayout:{...patch.bubbleLayout,origin:'manual'}}]};
  const runner={async runPage(request){request.page.blocks[0].sourceText='adapter mutation';return {patches:[{...patch,sourceText:'forbidden'}]};}};
  for(const overwriteManual of [false,true]){
    const args={page:manual,blockIds:['b'],runner,signal:new AbortController().signal,config:{policy:'balanced',overwriteManual}};
    const actual=await runBubbleLayoutPostprocess(args);
    assert.deepEqual(actual,await reference('src/main/inpainting/bubbleLayoutRunner.ts').runBubbleLayoutPostprocess(args));
    assert.equal(actual.page.blocks[0].sourceText,base.sourceText);
    assert.equal(actual.page.blocks[0].bubbleLayout.origin,overwriteManual?'detected':'manual');
  }
});

test('config preserves model-free baseline and refuses unsupported automatic font scope',async()=>{
  const {parseConfigToml}=await import('../dist/cli/config-file.js');
  const text='version=1\nmode="smoke"\n[paths]\ninput="in"\noutput="out"\n[typography]\nautoFont=false\nautoSize=true\nbubbleLayout=true\nnaturalLayout=false\noverwrite=["layout"]';
  assert.deepEqual({...parseConfigToml(text,'/tmp').typography},{autoFont:false,autoSize:true,bubbleLayout:true,naturalLayout:false,overwrite:['layout']});
  assert.throws(()=>parseConfigToml(text.replace('autoFont=false','autoFont=true'),'/tmp'),/D17/);
  assert.throws(()=>parseConfigToml(text.replace('autoSize=true','autoSize="yes"'),'/tmp'),/boolean/);
});

test('layout stage failure persists prior typography and skips later stage for only that page',async()=>{
  const {run}=await import('../dist/core/run.js');
  const {typographyStage}=await import('../dist/typography/stage.js');
  const {layoutStage}=await import('../dist/layout/stage.js');
  const pages=[structuredClone(page),{...structuredClone(page),id:'q'}];
  const saved=[], rendered=[];
  const result=await run({version:1,mode:'smoke',input:'/tmp/input',output:'/tmp/output',stages:['typography','erase','layout','render']}, {
    persistence:{async initialize(){return {id:'c',pages};},async commit(c){saved.push(structuredClone(c));},async finish(){}},
    stages:[typographyStage(async()=>raster()),{id:'erase',reads:[],writes:[],resources:[],async execute(p){return {status:'completed',page:p};}},
      layoutStage({async runPage(request){if(request.page.id==='p')throw new Error('Koharu failure');return {patches:[]};}}),
      {id:'render',reads:[],writes:[],resources:[],async execute(p){rendered.push(p.id);return {status:'completed',page:p};}}],
  });
  assert.equal(result.status,'partial');assert.equal(result.issues[0].stage,'layout');assert.deepEqual(rendered,['q']);
  assert.ok(saved.at(-1).pages.every(p=>p.blocks[0].fontSizeIntent==='source-match'));
  assert.equal(saved.at(-1).pages[0].blocks[0].bubbleLayout,undefined);
});
