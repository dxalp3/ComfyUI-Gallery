const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
const source = ts.transpileModule(fs.readFileSync('web/src/PrefixLibrary.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const { load } = require('./ts_loader.cjs');
// PrefixLibrary needs the real prompt parser (top-level comma splitting); everything else is stubbed.
const context = { exports: {}, require: name => name === './PromptBoxes' ? load('PromptBoxes.ts') : ({ getComfyApp() {} }) };
vm.runInNewContext(source, context);
const expand = value => Array.from(context.exports.expandSearchTerms(library, value));
const library = { version: 2, tags: [{ id: 'a', name: 'Pose', text: 'standing, hands_up' }, { id: 'b', name: 'Eyes', text: 'blue eyes' }], prefixes: [{ id: 'p', name: 'reference', tags: ['a', 'b'] }] };
test('named prefixes and copied expansions yield individual search chips', () => {
    assert.deepEqual(expand('@reference'), ['standing', 'hands_up', 'blue eyes']);
    assert.deepEqual(expand('standing, hands_up, blue eyes'), ['standing', 'hands_up', 'blue eyes']);
    assert.deepEqual(expand('standing, hands_up'), ['standing', 'hands_up']);
});
test('excluded prefixes and compound vocabulary exclude each term', () => {
    assert.deepEqual(expand('-@reference'), ['-standing', '-hands_up', '-blue eyes']);
    assert.deepEqual(expand('-standing, hands_up'), ['-standing', '-hands_up']);
});
test('literal tags, unknown prefixes and comma-bearing system predicates stay intact', () => {
    for (const value of ['artist:one, two', 'system:filetype = image, video', '@unknown', 'blue eyes']) assert.deepEqual(expand(value), [value]);
});

test('grouped prefix terms stay whole: commas inside {…} or (…) do not split them', () => {
    const grouped = { version: 2, tags: [{ id: 'g', name: 'LoRA', text: 'activator tag, {tag1|}, {(tag2, tag3)|}, (tag4:0.5)' }], prefixes: [{ id: 'l', name: 'lora', tags: ['g'] }] };
    assert.deepEqual(Array.from(context.exports.expandPrefix(grouped, '@lora')), ['activator tag', '{tag1|}', '{(tag2, tag3)|}', '(tag4:0.5)']);
});
