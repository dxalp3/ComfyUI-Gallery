const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const { collectSessionOutputs } = load('SessionOutputCollection');
const { sourceViewerEntry, recoverSourceOriginals, recoverStoredSourceMetadata } = load('SourceViewer');
const { imageOrigin } = load('ImageSourceGeometry');
const hash = 'a'.repeat(64);
const image = { input_name: `gallery_sources/${hash}.png`, title: 'image.png' };
const file = (url, name = 'image.png') => ({ url, name, type: 'image', timestamp: 0, date: '' });
const entry = file => ({ id: 'local:' + file.url, source: 'local', local: file });

test('session outputs start empty and collect only execution images, encoding folders', () => {
    assert.equal(collectSessionOutputs([], {} ).length, 0);
    const files = collectSessionOutputs([], { images: [{ filename: 'a b.png', subfolder: 'run/test' }, { filename: 'input.png', type: 'input' }] }, 1000);
    assert.equal(files.length, 1);
    assert.equal(files[0].url, '/static_gallery/run/test/a%20b.png');
    assert.equal(files[0].timestamp, 1);
});
test('session outputs keep newest first and deduplicate reruns', () => {
    let files = collectSessionOutputs([], { images: [{ filename: 'one.png' }] }, 1000);
    files = collectSessionOutputs(files, { images: [{ filename: 'two.png' }] }, 2000);
    files = collectSessionOutputs(files, { images: [{ filename: 'one.png' }] }, 3000);
    assert.deepEqual(Array.from(files, f => f.name), ['one.png', 'two.png']);
    assert.equal(files[0].timestamp, 3);
});
test('temporary preview outputs use ComfyUI view references, separate from saved images', () => {
    const files = collectSessionOutputs([], { images: [{filename:'preview.png',type:'temp',subfolder:'run'}, {filename:'preview.png',type:'output',subfolder:'run'}] });
    assert.equal(files.length, 2);
    assert.equal(files[0].url, '/static_gallery/run/preview.png');
    assert.equal(files[1].url, '/view?filename=preview.png&subfolder=run&type=temp');
});
test('known gallery originals retain actions even outside the current index', () => {
    const result = sourceViewerEntry({ ...image, metadata: { gallery_url: '/static_gallery/image.png', gallery_origin: 'gallery' } }, [], entry);
    assert.equal(result.source, 'local');
    assert.equal(result.local.url, '/static_gallery/image.png');
});
test('legacy source originals use content hashes rather than filenames alone', async () => {
    const files = [file('/static_gallery/wrong/image.png'), file('/static_gallery/right/image.png')];
    const recovered = await recoverSourceOriginals([image], files, async () => ({ [files[0].url]: 'b'.repeat(64), [files[1].url]: hash }));
    assert.equal(recovered[0].metadata.gallery_url, files[1].url);
    assert.equal(sourceViewerEntry(recovered[0], files, entry).source, 'local');
    const unmatched = await recoverSourceOriginals([image], files, async () => ({}));
    assert.equal(sourceViewerEntry(unmatched[0], files, entry).source, 'node');
});
test('external input images never acquire gallery actions from a matching name', async () => {
    const external = { ...image, metadata: { gallery_origin: 'external' } };
    const recovered = await recoverSourceOriginals([external], [file('/static_gallery/image.png')], async () => { throw Error('should not scan'); });
    assert.equal(sourceViewerEntry(recovered[0], [], entry).source, 'node');
});
test('legacy originals can be recovered after a filename change', async () => {
    const renamed = file('/static_gallery/renamed.png', 'renamed.png');
    const recovered = await recoverSourceOriginals([image], [renamed], async () => ({ [renamed.url]: hash }));
    assert.equal(recovered[0].metadata.gallery_url, renamed.url);
});
test('Hydrus sources retain gallery actions and preview from the saved input copy', () => {
    const remote = { hash, file_id: 4, mime: 'image/png', tags: { service: {} } };
    const source = { ...image, metadata: { gallery_origin: 'gallery', hydrus: remote } };
    assert.equal(imageOrigin(source), 'hydrus');
    const result = sourceViewerEntry(source, [], entry);
    assert.equal(result.source, 'hydrus');
    assert.equal(result.hash, hash);
    assert.equal(result.remote.file_id, 4);
    assert.ok(result.previewUrl.startsWith('/view?'));
});
test('Hydrus copies with missing workflow metadata resolve by their input path', () => {
    const source = { input_name: `hydrus/${hash}.png`, metadata: { gallery_origin: 'gallery' } };
    assert.equal(imageOrigin(source), 'hydrus');
    assert.equal(sourceViewerEntry(source, [], entry).source, 'hydrus');
});
test('stored provenance recovers Hydrus metadata without replacing workflow prefix edits', async () => {
    const source = { ...image, metadata: { gallery_origin:'gallery', gallery_prefix: { id:'edited' } } };
    const recovered = await recoverStoredSourceMetadata([source], async () => ({ [image.input_name]: { hydrus: { hash, file_id:4, tags:{} }, gallery_prefix:{id:'old'} } }));
    assert.equal(recovered[0].metadata.gallery_prefix.id, 'edited');
    assert.equal(sourceViewerEntry(recovered[0], [], entry).source, 'hydrus');
});
