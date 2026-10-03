// Read-only comparison with recorded Carrot OpenAI-API prompt artifacts.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { getOverlayPrompt, buildSystemPrompt } from '../src/translation/ported/runtime/simple-page-prompts.mjs';
async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path); else if (entry.name === 'result.json') yield path;
  }
}
const [root, out] = process.argv.slice(2);
if (!root || !out) throw new Error('Usage: node tools/validate-translation-artifacts.mjs <Carrot runs root> <new evidence directory>');
await mkdir(out);
const records = [];
const sections = text => new Map(text.split(/(?=^# )/m).filter(Boolean).map(s => [s.split('\n')[0], s.trim()]));
for await (const path of files(resolve(root))) {
  const raw = await readFile(path, 'utf8'), result = JSON.parse(raw), s = result.requestSummary;
  if (!result.prompt || !result.systemPrompt || !s?.imageVariants?.length) continue;
  const variants = s.imageVariants, image = variants[0];
  const options = { ...s.options, imageWidth: image.width, imageHeight: image.height,
    previousBlocksForPrompt: s.previousBlocksForPrompt, ocrBboxHints: s.ocrBboxHints,
    collectPageContext: result.prompt.includes('# Page context trailer'), cumulativeContextDetail: 'detailed',
    ocrTextEvidenceCount: s.ocrTextEvidenceCount, ocrTranscriptEvidenceCount: s.ocrTranscriptEvidenceCount };
  const prompt = getOverlayPrompt(options, variants), original = sections(result.prompt), actual = sections(prompt);
  const allTitles = [...new Set([...original.keys(), ...actual.keys()])];
  const matches = [], differences = [];
  for (const title of allTitles) (original.get(title) === actual.get(title) ? matches : differences).push(title);
  records.push({ path, sha256: createHash('sha256').update(raw).digest('hex'), provider: s.options.modelProvider,
    systemExact: buildSystemPrompt(options) === result.systemPrompt, matchedSections: matches, differingSections: differences,
    missingWorkContextSnapshot: true, optionsFrom: 'stored requestSummary.options + hints/previousBlocks/image dimensions',
    promptBytes: Buffer.byteLength(result.prompt), reconstructedBytes: Buffer.byteLength(prompt) });
  if (records.length === 3) break;
}
if (!records.length) throw new Error('No recorded vision prompt artifacts found');
await writeFile(join(out, 'artifact-comparison.json'), JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(records, null, 2));
