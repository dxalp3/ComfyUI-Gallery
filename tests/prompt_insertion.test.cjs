const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('../web/node_modules/typescript');
const compiled={exports:{}};const source=ts.transpileModule(fs.readFileSync('web/src/PromptInsertion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInThisContext(`(function(exports,module){${source}})`)(compiled.exports,compiled);
const {formatInsertion,defaultInsertion,combineEncoderPrompt}=compiled.exports;
test('bulk insertion deduplicates plain tags and retains entire prefixes as alternatives',()=>{
 assert.equal(formatInsertion([['standing','blue eyes'],['sitting','red eyes']],{...defaultInsertion,format:'alternatives'}),'{standing, blue eyes|sitting, red eyes}');
 assert.equal(formatInsertion([['standing'],['standing','blue eyes']],defaultInsertion),'standing, blue eyes');
 assert.equal(formatInsertion([['standing'],['standing']],{...defaultInsertion,format:'alternatives'}),'standing');
});
test('weights and text affixes wrap the whole insertion without losing alternatives',()=>{
 assert.equal(formatInsertion([['long hair'],['short hair']],{...defaultInsertion,format:'alternatives',weight:1.2,prefix:'portrait, ',suffix:', detailed'}),'(portrait, {long hair|short hair}, detailed:1.2)');
 assert.equal(formatInsertion([],defaultInsertion),'');
});
test('source order supports appended default, prepending, explicit replacement and empty input',()=>{
 assert.equal(combineEncoderPrompt('base','source'),'base, source');assert.equal(combineEncoderPrompt('base','source','before'),'source, base');assert.equal(combineEncoderPrompt('base','','replace'),'');assert.equal(combineEncoderPrompt('base',''),'base');assert.equal(combineEncoderPrompt('base',undefined),'base');
});

test('optional alternatives preserve an empty branch even for a single unique choice',()=>{
 assert.equal(formatInsertion([['a'],['b'],['c']],{...defaultInsertion,format:'optional'}),'{a|b|c|}');
 assert.equal(formatInsertion([['a'],['a']],{...defaultInsertion,format:'optional'}),'{a|}');
 assert.equal(formatInsertion([],{...defaultInsertion,format:'optional'}),'');
 assert.equal(formatInsertion([['standing','blue eyes'],['sitting']],{...defaultInsertion,format:'optional'}),'{standing, blue eyes|sitting|}');
});
test('multiple categories produce independent groups, with optional branches and block modifiers',()=>{
 const groups=[['long hair','short hair','long hair'],['smile','frown']];
 assert.equal(formatInsertion(groups,{...defaultInsertion,format:'alternatives',categoryGroups:true}),'{long hair|short hair}, {smile|frown}');
 assert.equal(formatInsertion(groups,{...defaultInsertion,format:'optional',categoryGroups:true,weight:1.2,prefix:'portrait, ',suffix:', detailed'}),'(portrait, {long hair|short hair|}, {smile|frown|}, detailed:1.2)');
});
