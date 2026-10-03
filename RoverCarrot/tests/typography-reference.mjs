// Executes unmodified source functions in memory; no writes to the reference.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
const root = resolve('..'), external = createRequire(import.meta.url);
export function createReference(overrides = {}) {
  const cache = new Map();
  function load(path) {
    if (path in overrides) return overrides[path];
    if (cache.has(path)) return cache.get(path).exports;
    const full = resolve(root, path), module = { exports: {} }; cache.set(path, module);
    let source = readFileSync(full, 'utf8');
    const selections = {
      'src/main/pageWorkflow/pageWorkflowTypographyInput.ts': ['workflowOverlayItems', 'workflowOcrHints'],
      'src/main/pipeline/keepBlocksResult.ts': ['buildKeepBlocksOcrResult'],
    };
    if (selections[path]) {
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      source = ast.statements.filter(s => ts.isImportDeclaration(s) || ts.isExportDeclaration(s) || selections[path].includes(s.name?.text)).map(s => s.getText(ast)).join('\n');
      // TypeScript removes imports unused by the selected functions.
    }
    source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024 } }).outputText;
    const local = specifier => specifier.startsWith('.') ? load(resolve(dirname(full), specifier + '.ts').slice(root.length + 1)) : external(specifier);
    new Function('require', 'module', 'exports', source)(local, module, module.exports);
    return module.exports;
  }
  return load;
}
export const reference = createReference({
  'src/main/pipeline/pipelineLogger.ts': { logPipelineWarning() {} },
});
