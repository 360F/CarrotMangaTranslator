// Orchestrator's real four-page CLI run; no injected stages/runtimes.
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { parseConfigToml } from '../dist/cli/config-file.js';
import { runCli } from '../dist/cli/app.js';
const [file] = process.argv.slice(2);
if (!file) throw new Error('Usage: node tools/typography-smoke.mjs <isolated-step5.toml>');
const projectRoot=resolve('.'), config=parseConfigToml(await readFile(file,'utf8'),projectRoot);
assert.deepEqual(config.stages,['detect','ocr','translate','typography','erase','layout']);
assert.equal(config.ocr?.device,'gpu');assert.ok(config.translation);assert.ok(config.models?.koharu);
const code=await runCli({argv:[],projectRoot,cwd:projectRoot,configPath:resolve(file),isTTY:false,write:text=>process.stdout.write(text)});
assert.equal(code,0);
const index=JSON.parse(await readFile(join(config.output,'index.json'),'utf8'));
const workDir=join(config.output,'works',index.workOrder[0]);
const work=JSON.parse(await readFile(join(workDir,'work.json'),'utf8'));
const chapter=JSON.parse(await readFile(join(workDir,'chapters',work.chapterOrder[0],'chapter.json'),'utf8'));
assert.equal(chapter.pages.length,4);
assert.ok(chapter.pages.some(p=>p.blocks.some(b=>b.translatedText.trim())));
assert.ok(chapter.pages.some(p=>p.blocks.some(b=>b.sourceFontSizeMethod==='raster-core-v1')));
for(const p of chapter.pages)assert.equal(p.inpaintedImagePath,undefined,'Step 6 erase remains no-op');
for(const file of await readdir(join(config.output,'runs'))){
 const run=JSON.parse(await readFile(join(config.output,'runs',file),'utf8'));
 assert.equal(run.status,'completed');
 assert.equal(run.events.filter(e=>e.type==='stage-end'&&e.stage==='layout'&&e.status==='failed').length,0);
}
console.log(JSON.stringify({chapter:join(workDir,'chapters',work.chapterOrder[0],'chapter.json'),pages:chapter.pages.map(p=>({id:p.id,blocks:p.blocks.length,translated:p.blocks.filter(b=>b.translatedText.trim()).length,sourceMatched:p.blocks.filter(b=>b.sourceFontSizeMethod==='raster-core-v1').length,bubbleLayouts:p.blocks.filter(b=>b.bubbleLayout).length}))},null,2));
