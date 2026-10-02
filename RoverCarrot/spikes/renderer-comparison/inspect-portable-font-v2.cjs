const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const spikeRoot = __dirname;
const repoRoot = path.resolve(spikeRoot, "../../..");
const manifestPath = path.join(spikeRoot, "fixtures", "manifest.json");
const fontPath = path.join(spikeRoot, "assets", "fonts", "noto-sans-cjk-kr-2.004", "NotoSansCJKkr-Regular.otf");
const outputPath = path.join(spikeRoot, "reference-v2-noto-sans-cjk-kr-2.004", "font-verification.json");
const probePath = path.join(spikeRoot, ".portable-font-v2-probe.html");
const family = "Rover Benchmark Noto Sans CJK KR";
const windows = new Set();
function category(c){if(/\p{Script=Hangul}/u.test(c))return"korean";if(/[A-Za-z]/u.test(c))return"latin";if(/[0-9]/u.test(c))return"digits";if(/\p{P}/u.test(c))return"punctuation";if(/\p{S}/u.test(c))return"symbols";return"other"}
async function fontsFor(debuggerApi, selector){const{root}=await debuggerApi.sendCommand("DOM.getDocument",{depth:-1,pierce:true});const{nodeId}=await debuggerApi.sendCommand("DOM.querySelector",{nodeId:root.nodeId,selector});if(!nodeId)throw new Error(`Missing ${selector}`);return(await debuggerApi.sendCommand("CSS.getPlatformFontsForNode",{nodeId})).fonts}
async function run(){
 const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));const blocks=[];
 for(const fixture of manifest.fixtures){const snapshot=JSON.parse(fs.readFileSync(path.join(repoRoot,fixture.pageSnapshot.path),"utf8"));for(const block of snapshot.blocks)if(block.translatedText)blocks.push({pageId:fixture.pageId,pageName:fixture.sourcePage,blockId:block.id,text:block.translatedText,fontSizePx:block.fontSizePx})}
 const glyphs=[...new Set(blocks.flatMap(b=>[...b.text]))].filter(c=>! /\s/u.test(c)).sort((a,b)=>a.codePointAt(0)-b.codePointAt(0));
 const payload=Buffer.from(JSON.stringify({blocks,glyphs})).toString("base64");const fontUrl=pathToFileURL(fontPath).toString();
 const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>@font-face{font-family:"${family}";src:url("${fontUrl}") format("opentype");font-weight:400;font-style:normal;font-display:block}.probe{font-family:"${family}";font-weight:400;font-style:normal;white-space:pre-wrap}</style><main id="root"></main><script>const d=JSON.parse(atob("${payload}")),r=document.getElementById("root");d.blocks.forEach((b,i)=>{const n=document.createElement("span");n.id="b-"+i;n.className="probe";n.style.fontSize=b.fontSizePx+"px";n.textContent=b.text;r.append(n,document.createElement("br"))});d.glyphs.forEach((g,i)=>{const n=document.createElement("span");n.id="g-"+i;n.className="probe";n.textContent=g;r.append(n)})</script>`;
 await fsp.writeFile(probePath,html,"utf8");const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true}});windows.add(win);
 try{await win.loadFile(probePath);await win.webContents.executeJavaScript(`document.fonts.load('400 16px "${family}"').then(()=>document.fonts.ready).then(()=>true)`);win.webContents.debugger.attach("1.3");await win.webContents.debugger.sendCommand("DOM.enable");await win.webContents.debugger.sendCommand("CSS.enable");const blockResults=[];for(let i=0;i<blocks.length;i++)blockResults.push({...blocks[i],fonts:await fontsFor(win.webContents.debugger,`#b-${i}`)});const glyphResults=[];for(let i=0;i<glyphs.length;i++)glyphResults.push({character:glyphs[i],codePoint:`U+${glyphs[i].codePointAt(0).toString(16).toUpperCase().padStart(4,"0")}`,category:category(glyphs[i]),fonts:await fontsFor(win.webContents.debugger,`#g-${i}`)});
 const all=[...blockResults,...glyphResults];for(const item of all){if(item.fonts.length!==1||item.fonts[0].familyName!=="Noto Sans CJK KR"||item.fonts[0].postScriptName!=="NotoSansCJKkr-Regular"||item.fonts[0].isCustomFont!==true)throw new Error(`Unexpected fallback: ${JSON.stringify(item)}`)}
 const result={version:1,revision:"portable-font-reference-v2",runtime:{electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch},font:{familyName:"Noto Sans CJK KR",postScriptName:"NotoSansCJKkr-Regular",isCustomFont:true},fixtureCount:manifest.fixtures.length,blockCount:blockResults.length,uniqueNonWhitespaceGlyphCount:glyphResults.length,unexpectedFallbacks:0,blocks:blockResults,glyphs:glyphResults};await fsp.writeFile(outputPath,`${JSON.stringify(result,null,2)}\n`,"utf8");console.log(`Verified ${blockResults.length} blocks and ${glyphResults.length} glyphs`)
 }finally{if(win.webContents.debugger.isAttached())win.webContents.debugger.detach();win.destroy();windows.delete(win);await fsp.rm(probePath,{force:true})}
}
app.whenReady().then(run).then(()=>app.quit(),error=>{console.error(error);app.exit(1)});
