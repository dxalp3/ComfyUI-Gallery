// Run: node --test tests/prefix_lineage.test.cjs (after installing web dependencies).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const L = load('PrefixLineage');
const h = c => c.repeat(64);
const source = (hash, extra = {}) => ({ prompt: { '1': { class_type: 'GalleryImageSource', inputs: { sources: JSON.stringify({ version: 1, layout: 'single', active_index: 0, images: [{ input_name: 'gallery_sources/' + hash + '.png', ...extra }] }) } } } });
const file = (url, metadata, timestamp = 1) => ({ name: url.split('/').pop(), url, type: 'image', timestamp, metadata });

test('generations are linked to their source images by hash, and by the prefix id of an appended image', () => {
    assert.deepEqual(L.sourceLinks(source(h('a'))), { hashes: [h('a')], prefixIds: [] });
    assert.deepEqual(L.sourceLinks(source(h('b'), { metadata: { gallery_prefix: { id: 'p1' } } })).prefixIds, ['p1']);
    // Only the active image of a single-image source was used.
    const manifest = { version: 1, layout: 'single', active_index: 1, images: [{ input_name: 'hydrus/' + h('c') + '.png' }, { input_name: 'hydrus/' + h('d') + '.png' }] };
    assert.deepEqual(L.sourceLinks({ workflow: { nodes: [{ type: 'GalleryImageSource', widgets_values: [JSON.stringify(manifest)] }] } }).hashes, [h('d')]);
});

test('find images follows paired images through several generations, whatever the prompt', async () => {
    const files = [
        file('/static_gallery/paired.png', {}),
        file('/static_gallery/gen1.png', source(h('1'))),
        file('/static_gallery/gen2.png', source(h('2'))),
        file('/static_gallery/other.png', source(h('9'))),
        file('/static_gallery/via-prefix.png', source(h('8'), { metadata: { gallery_prefix: { id: 'p1' } } })),
    ];
    const library = { version: 2, tags: [], prefixes: [{ id: 'p1', name: 'Pose', tags: [] }], associations: { 'local:./:/static_gallery/paired.png': { prefix_id: 'p1', terms: [] }, ['sha256:' + h('h')]: { prefix_id: 'p1', terms: [], image: { hash: h('h') } } } };
    const hashes = { '/static_gallery/paired.png': h('1'), '/static_gallery/gen1.png': h('2'), '/static_gallery/gen2.png': h('3') };
    const asked = [];
    const result = await L.findLineage(files, library, 'p1', async urls => { asked.push(...urls); return Object.fromEntries(urls.filter(url => hashes[url]).map(url => [url, hashes[url]])); });
    assert.deepEqual(result.paired.map(f => f.url), ['/static_gallery/paired.png']);
    assert.deepEqual(result.generated.map(item => [item.file.url, item.depth]), [['/static_gallery/gen1.png', 1], ['/static_gallery/via-prefix.png', 1], ['/static_gallery/gen2.png', 2]]);
    assert.equal(result.remotePaired, 1);
    // Hashes already known from Hydrus exports are not asked for again.
    asked.length = 0;
    await L.findLineage(files, library, 'p1', async urls => { asked.push(...urls); return {}; }, { '/static_gallery/paired.png': h('1'), '/static_gallery/gen1.png': h('2') });
    assert.ok(!asked.includes('/static_gallery/paired.png'));
});

test('strict mode needs every prefix tag in some spelling; {a|b} terms are not required', () => {
    const image = file('/x.png', { prompt: { '2': { class_type: 'KSampler', inputs: { positive: ['3', 0] } }, '3': { class_type: 'CLIPTextEncode', inputs: { text: 'standing, Blonde_Hair, {smile|frown}' } } } });
    const tags = L.imageTagSet(image, ['character:alice']);
    assert.ok(tags.has('blonde hair') && tags.has('alice') && !tags.has('smile'));
    assert.deepEqual(L.requiredTerms(['standing, blond hair', '{smile|frown}']), ['standing', 'blond hair']);
    assert.equal(L.hasAllTerms(tags, [['standing'], ['blond hair', 'blonde_hair']]), true);
    assert.equal(L.hasAllTerms(tags, [['standing'], ['red hair']]), false);
});

test('an image belongs to the prefixes of the images it descends from', () => {
    const inner = source(h('a'), { metadata: { gallery_prefix: { id: 'p2' } } });
    const outer = source(h('b'), { metadata: inner });
    const { hashes, prefixIds } = L.ancestry(outer);
    assert.deepEqual([...hashes].sort(), [h('a'), h('b')]);
    assert.deepEqual([...prefixIds], ['p2']);
    const library = { version: 2, tags: [], prefixes: [{ id: 'p1', name: 'A', tags: [] }, { id: 'p2', name: 'B', tags: [] }] };
    assert.deepEqual(L.imagePrefixIds(library, [], outer, new Map([[h('a'), new Set(['p1'])]])).sort(), ['p1', 'p2']);
});

test('the lineage tree knows what each image was made from and which generations became sources', async () => {
    const files = [file('/static_gallery/a.png', source(h('1'))), file('/static_gallery/b.png', source(h('2'))), file('/static_gallery/c.png', source(h('1')))];
    const hashes = { '/static_gallery/a.png': h('2'), '/static_gallery/b.png': h('3'), '/static_gallery/c.png': h('4') };
    const tree = await L.lineageTree(files, [h('1')], [], async urls => Object.fromEntries(urls.map(url => [url, hashes[url]])));
    assert.deepEqual(tree.nodes.get('/static_gallery/b.png'), { depth: 2, parents: [h('2')] });
    assert.deepEqual([...tree.usedAsSource], ['/static_gallery/a.png']);
    const levels = L.ancestorLevels(source(h('2'), { metadata: source(h('1')) }));
    assert.deepEqual(levels.map(level => [level.hash, level.original]), [[h('2'), false], [h('1'), true]]);
});
