const { app, BrowserWindow } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repoRoot = path.resolve(__dirname, "../../..");
const manifestPath = path.join(__dirname, "fixtures", "manifest.json");
const outputPath = path.join(__dirname, "font-inspection-result.json");
const fontStack = '"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif';
function category(c) {
  if (/\p{Script=Hangul}/u.test(c)) return "korean";
  if (/[A-Za-z]/u.test(c)) return "latin";
  if (/[0-9]/u.test(c)) return "digits";
  if (/\p{P}/u.test(c)) return "punctuation";
  if (/\p{S}/u.test(c)) return "symbols";
  if (/\s/u.test(c)) return "whitespace";
  return "other";
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
async function platformFontsForSelector(debuggerApi, selector) {
  const { root } = await debuggerApi.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await debuggerApi.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`Missing inspection node: ${selector}`);
  const { fonts } = await debuggerApi.sendCommand("CSS.getPlatformFontsForNode", { nodeId });
  return fonts;
}
async function inspect() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const blocks = [];
  for (const fixture of manifest.fixtures) {
    const snapshot = JSON.parse(fs.readFileSync(path.join(repoRoot, fixture.pageSnapshot.path), "utf8"));
    for (const block of snapshot.blocks) {
      if (!block.translatedText) continue;
      blocks.push({ pageId: fixture.pageId, pageName: fixture.sourcePage, blockId: block.id, text: block.translatedText, fontSizePx: block.fontSizePx, bold: Boolean(block.bold), italic: Boolean(block.italic) });
    }
  }
  const characters = [...new Set(blocks.flatMap(({ text }) => [...text]))].filter((c) => !/\s/u.test(c)).sort((a,b) => a.codePointAt(0)-b.codePointAt(0));
  const payload = Buffer.from(JSON.stringify({ blocks, characters })).toString("base64");
  const html = `<!doctype html><meta charset="utf-8"><style>body{font-family:${fontStack}}.probe{white-space:pre-wrap;font-weight:400;font-style:normal}</style><main id="root"></main><script>const data=JSON.parse(atob(${JSON.stringify(payload)}));const root=document.getElementById("root");data.blocks.forEach((block,index)=>{const node=document.createElement("span");node.id="block-"+index;node.className="probe";node.style.fontSize=block.fontSizePx+"px";node.style.fontWeight=block.bold?"800":"400";node.style.fontStyle=block.italic?"italic":"normal";node.textContent=block.text;root.append(node,document.createElement("br"))});data.characters.forEach((character,index)=>{const node=document.createElement("span");node.id="glyph-"+index;node.className="probe";node.textContent=character;root.append(node)})</script>`;
  const window = new BrowserWindow({ show:false, webPreferences:{offscreen:true,sandbox:true,contextIsolation:true} });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await window.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("DOM.enable");
    await window.webContents.debugger.sendCommand("CSS.enable");
    const blockResults=[];
    for(let i=0;i<blocks.length;i++) blockResults.push({...blocks[i],textSha256:sha256(Buffer.from(blocks[i].text,"utf8")),fonts:await platformFontsForSelector(window.webContents.debugger,`#block-${i}`)});
    const glyphResults=[];
    for(let i=0;i<characters.length;i++){const character=characters[i];glyphResults.push({character,codePoint:`U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4,"0")}`,category:category(character),fonts:await platformFontsForSelector(window.webContents.debugger,`#glyph-${i}`)})}
    const result={version:1,inspectedAt:new Date().toISOString(),runtime:{electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch},cssFontFamily:fontStack,fixtureCount:manifest.fixtures.length,blockCount:blockResults.length,uniqueNonWhitespaceGlyphCount:glyphResults.length,blocks:blockResults,glyphs:glyphResults};
    fs.writeFileSync(outputPath,`${JSON.stringify(result,null,2)}\n`,"utf8");process.stdout.write(`${outputPath}\n`);
  } finally { if(window.webContents.debugger.isAttached()) window.webContents.debugger.detach(); window.destroy(); }
}
app.whenReady().then(inspect).then(()=>app.quit(),error=>{console.error(error);app.exit(1)});
