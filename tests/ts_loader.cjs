// Load web/src TypeScript modules (and the local modules they import) for Node tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
const cache = new Map();
function load(name) {
    const filename = path.resolve(__dirname, '../web/src', name.replace(/^\.\//, '') + (name.endsWith('.ts') ? '' : '.ts'));
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInThisContext(`(function(exports,module,require){${source}\n})`, { filename })(module.exports, module, request => request.startsWith('.') ? load(request) : require(request));
    return module.exports;
}
module.exports = { load };
