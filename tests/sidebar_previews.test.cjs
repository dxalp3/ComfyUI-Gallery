const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const { collectSessionOutputs, visibleSessionOutputs } = load('SessionOutputCollection');
test('temporary ControlNet previews are hidden by default and can be restored without losing saved outputs', () => {
 const files=collectSessionOutputs([], {images:[{filename:'saved.png',type:'output'},{filename:'controlnet.png',type:'temp'}]});
 assert.deepEqual(visibleSessionOutputs(files).map(f=>f.name),['saved.png']);
 assert.equal(visibleSessionOutputs(files,true),files);
 assert.equal(files.length,2);
 assert.deepEqual(visibleSessionOutputs([{url:'/static_gallery/temp/saved.png'}, {url:'/view?type=output&filename=saved.png'}]).length,2);
});
