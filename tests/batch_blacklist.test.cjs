const {test}=require('node:test');const assert=require('node:assert/strict');const {load}=require('./ts_loader.cjs');
const {parsePrompt}=load('PromptBoxes');const {parseBatchBlacklist,batchChipBlocked,eligibleBatchIds}=load('BatchTagBlacklist');
test('blacklist normalizes spelling, case and duplicates without substring matching',()=>{
 const list=parseBatchBlacklist('Blue_Eyes\n blue eyes, b');assert.deepEqual(list,['blue eyes','b']);
 for(const text of ['BLUE EYES','(blue_eyes:1.4)','[blue eyes]','{red|{blue eyes|}|}'])assert(batchChipBlocked(parsePrompt(text)[0],list),text);
 assert(!batchChipBlocked(parsePrompt('light blue eyes')[0],list));
});
test('mixed grouped chips are excluded whole while other chips remain eligible',()=>{
 const chips=parsePrompt('safe, {blue eyes|red eyes}, {(blue eyes:1.3), smile|}, other');
 assert.deepEqual(eligibleBatchIds(chips,['blue eyes']),[chips[0].id,chips[3].id]);
 assert.equal(eligibleBatchIds(chips,[]).length,4);
 assert.deepEqual(eligibleBatchIds(chips,['safe','blue eyes','other']),[]);
});

test('a manually edited chip containing several tags is protected as a whole',()=>{
 assert(batchChipBlocked({id:'manual',kind:'tag',text:'safe, (blue_eyes:1.2)',enabled:true},['blue eyes']));
});
