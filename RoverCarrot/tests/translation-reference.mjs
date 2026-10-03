// Read-only oracle: executes the fork source, never the Rover port.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
const root = resolve('..');
const external = createRequire(import.meta.url);
const cache = new Map();
const selections = {
  'src/main/runtime/simple-page-request-summary.cjs': ['summarizeOcrBboxHint', 'summarizeRecognitionSegments', 'summarizeImageVariants'],
  'src/shared/geometry.ts': ['bboxOverlapRatio', 'bboxToPixels'],
  'src/main/pipeline/keepBlocksResult.ts': ['buildKeepBlocksOcrResult'],
  'src/shared/reviewTable.ts': ['escapeDelimitedCell'],
  'src/main/linkedWorkspace/linkedWorkspaceTranslationJson.ts': ['buildTranslationJson', 'serializeTranslationCsv'],
  'src/shared/ipcSchemaPrimitives.ts': ['MAX_GLOSSARY_ENTRIES', 'MAX_CHARACTER_PROFILES'],
  'src/main/pipeline/overlayItems.ts': ['filterRejectedOrUncertainSoundItems', 'normalizeConfidence', 'normalizeOverlayTextRole', 'REQUIRED_SOUND_CONFIDENCE'],
};
const imports = {
  'src/main/runtime/simple-page-request-summary.cjs': 'const {readOcrCandidateText} = require("./simple-page-prompts.cjs"); const {truncateText} = require("./simple-page-runtime-common.cjs"); const {mimeFromPath} = require("./simple-page-image-utils.cjs");',
  'src/shared/geometry.ts': 'export {clamp, clampBbox, pixelsToBbox, normalizeBboxTo1000} from "./bboxNormalization";',
  'src/main/pipeline/keepBlocksResult.ts': 'import {bboxToPixels} from "../../shared/geometry";',
  'src/main/linkedWorkspace/linkedWorkspaceTranslationJson.ts': 'import {resolvePageBlocksForReading} from "../../shared/blockReadingOrder"; import {escapeDelimitedCell} from "../../shared/reviewTable";',
  'src/main/pipeline/overlayItems.ts': 'import {clamp} from "../../shared/geometry";',
};
function selected(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const names = selections[path];
  return (imports[path] ?? '') + ast.statements.filter(s => names.includes(s.name?.text) ||
    ts.isVariableStatement(s) && s.declarationList.declarations.some(d => names.includes(d.name.getText(ast))))
    .map(s => s.getText(ast)).join('\n');
}
export function reference(path) {
  const full = resolve(root, path);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} }; cache.set(full, module);
  if (path === 'src/main/pipeline/localization.ts') {
    module.exports.tMain = key => key; return module.exports;
  }
  let source = readFileSync(full, 'utf8');
  if (selections[path]) source = selected(source, path);
  if (path.endsWith('.cjs') && selections[path]) source += '\nmodule.exports = {summarizeOcrBboxHint,summarizeImageVariants};';
  if (path.endsWith('.ts')) source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024 } }).outputText;
  const local = specifier => {
    if (!specifier.startsWith('.')) return external(specifier);
    let target = resolve(dirname(full), specifier);
    if (!/\.(ts|cjs|json)$/.test(target)) target += '.ts';
    return reference(target.slice(root.length + 1));
  };
  new Function('require', 'module', 'exports', '__dirname', '__filename', source)(local, module, module.exports, dirname(full), full);
  return module.exports;
}
