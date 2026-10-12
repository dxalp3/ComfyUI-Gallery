const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./ts_loader.cjs');
const {emptyGroup,parsePrompt,compileBoxes,parseState,formatSelectedChips,addChips}=load('PromptBoxes');
const stateOf=text=>({version:1,boxes:[emptyGroup('Tags',parsePrompt(text))]});
test('box format wraps chips, persists and applies to later additions without rewriting weights',()=>{
 const state=stateOf('a, (b:1.2), [c]'), box=state.boxes[0];box.format='alternatives';
 assert.equal(compileBoxes(state),'{a|(b:1.2)|[c]}');
 assert.equal(compileBoxes(addChips(state,box.id,'d')),'{a|(b:1.2)|[c]|d}');
 const restored=parseState(JSON.parse(JSON.stringify(state)));assert.equal(restored.boxes[0].format,'alternatives');
 box.format='tag';assert.equal(compileBoxes(state),'a, (b:1.2), [c]');
 box.format='group';assert.equal(compileBoxes(state),'{a, (b:1.2), [c]|}');
 box.format='each';assert.equal(compileBoxes(state),'{a|}, {(b:1.2)|}, {[c]|}');
 box.chips.forEach(c=>c.enabled=false);assert.equal(compileBoxes(state),'');
});
test('selection conversion preserves unselected chips, weights and disabled selections',()=>{
 const state=stateOf('a, untouched, (b:1.4), c');state.boxes[0].chips[3].enabled=false;
 const box=state.boxes[0], ids=[box.chips[0].id,box.chips[2].id,box.chips[3].id];
 const converted=formatSelectedChips(state,box.id,ids,'alternatives');
 assert.equal(compileBoxes(converted),'{a|(b:1.4)}, untouched');
 assert.equal(converted.boxes[0].chips.at(-1).enabled,false);
 const unpacked=formatSelectedChips(converted,box.id,[converted.boxes[0].chips[0].id],'tag');
 assert.equal(compileBoxes(unpacked),'a, (b:1.4), untouched');
});
test('batch splitting distributes a grouped weight and does not enable disabled tags',()=>{
 const state=stateOf('({a|b}:1.3)');const box=state.boxes[0];
 const next=formatSelectedChips(state,box.id,[box.chips[0].id],'tag');
 assert.equal(compileBoxes(next),'(a:1.3), (b:1.3)');
});
