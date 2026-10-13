const {test}=require('node:test');const assert=require('node:assert/strict');const {load}=require('./ts_loader.cjs');
const {parsePrompt,emptyGroup,compileBoxes,addBoxWithChip,parseState}=load('PromptBoxes');const {parseBatchBlacklist,batchChipBlocked,eligibleBatchIds,availableBatchTags,applyBatchTags,removeTagsFromChip}=load('BatchTagBlacklist');
test('blacklist searches individual normalized tags inside nested groups',()=>{
 const list=parseBatchBlacklist('Blue_Eyes\n blue eyes, b');assert.deepEqual(list,['blue eyes','b']);
 for(const text of ['BLUE EYES','(blue_eyes:1.4)','[blue eyes]'])assert(batchChipBlocked(parsePrompt(text)[0],list),text);
 const mixed=parsePrompt('safe, {blue eyes|red eyes}, {(blue eyes:1.3), smile|}, other');
 assert.deepEqual(eligibleBatchIds(mixed,['blue eyes']),mixed.map(chip=>chip.id));
 assert.deepEqual(availableBatchTags(mixed),['blue eyes','other','red eyes','safe','smile']);
});
test('batch removal leaves protected tags in their original groups',()=>{
 const chips=parsePrompt('safe, {blue eyes|red eyes}, {(blue eyes:1.3), smile|}, other');const box=emptyGroup('Tags',chips);const state={version:1,boxes:[box]};
 const removed=applyBatchTags(state,box.id,chips.map(chip=>chip.id),['blue eyes'],'remove');
 assert.equal(compileBoxes(removed),'blue eyes, {(blue eyes:1.3)|}');
 assert.equal(compileBoxes(state),'safe, {blue eyes|red eyes}, {(blue eyes:1.3), smile|}, other');
});
test('batch formatting and disabling affect allowed leaves only, retaining weights',()=>{
 const box=emptyGroup('Tags',parsePrompt('({locked|a|b}:1.3)'));const state={version:1,boxes:[box]};
 const formatted=applyBatchTags(state,box.id,[box.chips[0].id],['locked'],'format','each');
 assert.equal(compileBoxes(formatted),'(locked:1.3), {(a:1.3)|}, {(b:1.3)|}');
 const disabled=applyBatchTags(state,box.id,[box.chips[0].id],['locked'],'disable');assert.equal(compileBoxes(disabled),'(locked:1.3)');
});
test('negative tag entry recursively removes matching tags without substring deletion',()=>{
 const chip=parsePrompt('({red, (blue_eyes:1.2)|light blue eyes}:1.4)')[0];const result=removeTagsFromChip(chip,['blue eyes']);
 assert.equal(load('PromptBoxes').compileChip(result),'({red|light blue eyes}:1.4)');
});
test('fresh terms reuse an empty tag box and keep collapse state when restored',()=>{
 const box=emptyGroup('Empty',[]);box.chipsCollapsed=true;const state={version:1,boxes:[box]};const next=addBoxWithChip(state,parsePrompt('fresh'));
 assert.equal(next.boxes.length,1);assert.equal(next.boxes[0].id,box.id);assert.equal(compileBoxes(next),'fresh');assert.equal(parseState(next).boxes[0].chipsCollapsed,true);
});
