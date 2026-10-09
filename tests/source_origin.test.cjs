const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const { imageOrigin, stampOrigin, removeSourceImage, emptyImageSourceManifest } = load('ImageSourceGeometry');

test('origins migrate old workflows and explicit provenance survives round trips', () => {
    assert.equal(imageOrigin({ input_name: 'hydrus/hash.png' }), 'hydrus');
    assert.equal(imageOrigin({ input_name: 'hydrus\\hash.png' }), 'hydrus');
    assert.equal(imageOrigin({ input_name: 'gallery_sources/hash.png' }), 'gallery');
    assert.equal(imageOrigin({ input_name: 'upload.png' }), 'external');
    assert.equal(imageOrigin({ input_name: 'gallery_sources/hash.png', metadata: { hydrus: {} } }), 'hydrus');
    const image = stampOrigin({ input_name: 'gallery_sources/hash.png', metadata: { prompt: 'kept' } }, 'external');
    assert.equal(imageOrigin(JSON.parse(JSON.stringify(image))), 'external');
    assert.equal(image.metadata.prompt, 'kept');
});

test('removing earlier, selected and last sources preserves valid output selection', () => {
    const images = ['a', 'b', 'c'].map(input_name => ({ input_name }));
    const manifest = { ...emptyImageSourceManifest(), images, active_index: 1 };
    const earlier = removeSourceImage(manifest, 0);
    assert.equal(earlier.images[earlier.active_index].input_name, 'b');
    const selected = removeSourceImage(manifest, 1);
    assert.equal(selected.images[selected.active_index].input_name, 'c');
    assert.equal(removeSourceImage({ ...manifest, active_index: 2 }, 2).active_index, 1);
    const empty = removeSourceImage({ ...manifest, images: [images[0]], active_index: 0 }, 0);
    assert.equal(empty.active_index, 0);
    assert.equal(empty.images.length, 0);
    assert.equal(manifest.images.length, 3);
    assert.equal(removeSourceImage(manifest, 99), manifest);
});
