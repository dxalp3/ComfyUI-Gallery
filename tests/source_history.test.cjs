const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const { mergeSourceHistory, filterSourceHistory, sourceStripRange, sourcePickerPlacement, SOURCE_HISTORY_LIMIT } = load('SourceHistory');
const image = (name, origin) => ({ input_name: name, metadata: { gallery_origin: origin } });

test('history preserves removed images and metadata across workflow serialization without duplicates', () => {
    const old = [image('a.png', 'gallery'), image('b.png', 'external')];
    const current = [{ ...old[0], crop: { x: 0, y: 0, width: .5, height: 1 } }, image('c.png', 'hydrus')];
    const history = mergeSourceHistory(old, current);
    assert.deepEqual(history.map(item => item.input_name), ['a.png', 'b.png', 'c.png']);
    assert.equal(history[0].crop.width, .5);
    assert.deepEqual(mergeSourceHistory(JSON.parse(JSON.stringify(history)), current), history);
    assert.deepEqual(mergeSourceHistory(undefined, current), current);
    assert.equal(old[0].crop, undefined);
});

test('history is bounded, tolerates damaged entries, and stays isolated by node', () => {
    const a = mergeSourceHistory([null, {}, 3], Array.from({ length: 150 }, (_, i) => image(`${i}.png`, 'gallery')));
    assert.equal(a.length, SOURCE_HISTORY_LIMIT);
    assert.equal(a[0].input_name, '22.png');
    assert.deepEqual(mergeSourceHistory(undefined, [image('other.png', 'external')]).map(item => item.input_name), ['other.png']);
});

test('All, Imported and Generated search only the supplied node history', () => {
    const history = [image('gallery_sources/sun.png', 'gallery'), image('upload.png', 'external'), image('hydrus/sun.png', 'hydrus')];
    assert.equal(filterSourceHistory(history, 'all', '', true).length, 3);
    assert.equal(filterSourceHistory(history, 'imported', '', true).length, 2);
    assert.deepEqual(filterSourceHistory(history, 'generated', 'SUN', true).map(item => item.input_name), ['gallery_sources/sun.png']);
    assert.deepEqual(filterSourceHistory(history, 'all', 'not-in-this-node', true), []);
    assert.equal(history[0].input_name, 'gallery_sources/sun.png');
});

test('strip always includes focused image and mounts no more than five thumbnails', () => {
    for (let count = 1; count <= 32; count++) for (let focus = 0; focus < count; focus++) {
        const { start, end } = sourceStripRange(count, focus);
        assert.ok(start >= 0 && end <= count && end - start <= 5);
        assert.ok(start <= focus && end > focus);
    }
});

test('dropdown anchors below, flips above and stays within viewport horizontally', () => {
    const rect = { left: 100, top: 100, right: 420, bottom: 300, width: 320, height: 200 };
    const below = sourcePickerPlacement(rect, { width: 1200, height: 900 });
    assert.equal(below.side, 'below'); assert.equal(below.top, 307);
    const above = sourcePickerPlacement({ ...rect, top: 700, bottom: 880 }, { width: 1200, height: 900 });
    assert.equal(above.side, 'above'); assert.equal(above.bottom, 207);
    const edge = sourcePickerPlacement({ ...rect, left: 1100, right: 1420 }, { width: 1200, height: 900 });
    assert.ok(edge.left + edge.width <= 1192);
});
