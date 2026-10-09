const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
function compile(name, globals = {}, imports = {}) {
    const file = path.resolve(__dirname, '../web/src/' + name + '.ts');
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: {} };
    const script = vm.runInNewContext('(function(exports,module,require){' + output + '\n})', globals, { filename: file });
    script(module.exports, module, key => imports[key]);
    return module.exports;
}
const geometry = compile('ImageSourceGeometry', { URLSearchParams });
const sourceHistory = compile('SourceHistory', {}, { './ImageSourceGeometry': geometry });
const search = compile('LocalImageSearch');
const plain = value => JSON.parse(JSON.stringify(value));
test('crop clamps reversed/outside drags and preserves at least one pixel', () => {
    assert.deepEqual(plain(geometry.cropFromPoints({ x: .9, y: .8 }, { x: -.2, y: .1 })), { x: 0, y: .1, width: .9, height: .7000000000000001 });
    assert.deepEqual(plain(geometry.clampCrop({ x: 1, y: 1, width: 0, height: 0 }, { width: 100, height: 100 })), { x: .99, y: .99, width: .01, height: .01 });
    assert.deepEqual(plain(geometry.clampCrop()), { x: 0, y: 0, width: 1, height: 1 });
});
test('input URLs retain literal path characters without double decoding', () => {
    const url = new URL(geometry.sourceImageUrl('gallery_sources/a # %20.png'), 'http://localhost');
    assert.equal(url.searchParams.get('filename'), 'a # %20.png');
    assert.equal(url.searchParams.get('subfolder'), 'gallery_sources');
    assert.equal(url.searchParams.get('type'), 'input');
});
test('quality search handles unknown dimensions, JPEG alias and non-image files', () => {
    const file = { type: 'image', name: 'source.JPEG', metadata: { fileinfo: { resolution: '1600 × 900' } } };
    assert.equal(search.matchesImageQualities(file, { minWidth: 1000, minHeight: 900, format: 'jpg' }), true);
    assert.equal(search.matchesImageQualities(file, { minWidth: 1000, minHeight: 901, format: '' }), false);
    assert.equal(search.matchesImageQualities({ ...file, metadata: {} }, { minWidth: 1, minHeight: 0, format: '' }), false);
    assert.equal(search.matchesImageQualities({ type: 'video', name: 'a.mp4' }, { minWidth: 0, minHeight: 0, format: '' }), true);
});
function bridgeFixture() {
    const graph = { _nodes: [], add(n) { n.id = this._nodes.length + 1; this._nodes.push(n); } };
    const app = { graph, canvas: { graph, selected_nodes: {} } };
    const window = { addEventListener() {}, dispatchEvent() {}, LiteGraph: { createNode() { return {
        comfyClass: 'GalleryImageSource', widgets: [{ name: 'sources', type: 'customtext', value: JSON.stringify(geometry.emptyImageSourceManifest()) }],
        addWidget(type, name, value, callback, options) { this.widgets.push({ type, name, value, callback, options }); },
    }; } } };
    const bridge = compile('ImageSourceBridge', { window, CustomEvent: class { constructor(type, detail) { this.type=type;this.detail=detail; } } }, { './SourceHistory': sourceHistory, './ComfyAppApi': { getComfyApp: () => app, STANDALONE: false }, './ImageSourceGeometry': geometry, './NodeWidgets': compile('NodeWidgets') });
    return { bridge, graph, app };
}
test('append creates one dedicated node and keeps serialized crop/layout across later appends', async () => {
    const { bridge, graph } = bridgeFixture();
    await bridge.appendToImageSource([{ input_name: 'a.png' }]);
    const node = graph._nodes[0];
    const manifest = bridge.readSourceManifest(node);
    manifest.layout = 'grid'; manifest.images[0].crop = { x: 0, y: 0, width: .5, height: 1 };
    bridge.saveSourceManifest(node, manifest);
    await bridge.appendToImageSource([{ input_name: 'b.png' }]);
    assert.equal(graph._nodes.length, 1);
    assert.equal(bridge.readSourceManifest(node).layout, 'grid');
    assert.equal(bridge.readSourceManifest(node).images[0].crop.width, .5);
    assert.equal(node.widgets[0].hidden, true);
    assert.equal(node.widgets[0].type, 'customtext', 'preserve the native widget serializer type');
    assert.equal(node.widgets[0].options?.serialize, undefined);
});
test('explicit targets, deleted nodes and source count limits are checked', async () => {
    const { bridge, graph } = bridgeFixture();
    await bridge.setSourceTarget('new');
    const first = graph._nodes[0];
    await bridge.setSourceTarget('new');
    await bridge.appendToImageSource([{ input_name: 'second.png' }]);
    assert.equal(bridge.readSourceManifest(first).images.length, 0);
    await bridge.setSourceTarget(String(first.id));
    await bridge.appendToImageSource(Array.from({ length: 32 }, () => ({ input_name: 'a.png' })));
    await assert.rejects(bridge.appendToImageSource([{ input_name: 'extra.png' }]), /at most 32/);
    assert.equal(bridge.readSourceManifest(first).images.length, 32);
    graph._nodes.splice(0, 1);
    assert.throws(() => bridge.saveSourceManifest(first, geometry.emptyImageSourceManifest()), /no longer/);
});

test('explicit prompt targets preserve per-image metadata and obey prepend/append/replace', async () => {
 const {bridge,graph}=bridgeFixture();
 graph.add({title:'Positive',widgets:[{name:'text',value:'original'}]});
 const key=JSON.stringify(['1',0]);
 await bridge.appendToImageSource([{input_name:'pose.png',metadata:{positive:'original metadata'},prompt:{positive:'standing',negative:'',tags:[]}}],{positive:key,mode:'before'});
 assert.equal(graph._nodes[0].widgets[0].value,'standing, original');
 assert.equal(bridge.readSourceManifest(graph._nodes[1]).images[0].metadata.positive,'original metadata');
 await bridge.appendToImageSource([{input_name:'pose2.png',prompt:{positive:'blue eyes',negative:'',tags:[]}}],{positive:key,mode:'replace'});
 assert.equal(graph._nodes[0].widgets[0].value,'blue eyes');
 const length=bridge.readSourceManifest(graph._nodes[1]).images.length;
 await assert.rejects(bridge.appendToImageSource([{input_name:'bad.png'}],{positive:JSON.stringify(['999',0]),mode:'after'}),/no longer/);
 assert.equal(bridge.readSourceManifest(graph._nodes[1]).images.length,length);
});

test('direct library insertion reads the current target text and records before/after changes', async () => {
 const {bridge,graph}=bridgeFixture();let changes=0;graph.beforeChange=()=>changes++;
 const node={id:17,title:'Positive',widgets:[{name:'text',value:'base',inputEl:{value:'base'}}]};graph._nodes.push(node);
 const target=JSON.stringify(['17',0]);
 assert.equal(await bridge.writePromptTarget(target,'{long hair|short hair}','after'),'base, {long hair|short hair}');
 node.widgets[0].value='manually changed';
 assert.equal(await bridge.writePromptTarget(target,'(blue eyes:1.2)','before'),'(blue eyes:1.2), manually changed');
 assert.equal(node.widgets[0].inputEl.value,node.widgets[0].value);assert.equal(changes,2);
 await assert.rejects(bridge.writePromptTarget(JSON.stringify(['missing',0]),'x','after'),/valid prompt target/);
});

test('source history survives removing an image and workflow serialization, independently per node', async () => {
    const { bridge, graph } = bridgeFixture();
    await bridge.appendToImageSource([{ input_name: 'a.png' }, { input_name: 'b.png' }]);
    const first = graph._nodes[0];
    bridge.saveSourceManifest(first, geometry.removeSourceImage(bridge.readSourceManifest(first), 0));
    const saved = JSON.parse(JSON.stringify({ properties: first.properties, widgets: first.widgets }));
    assert.deepEqual(plain(bridge.readSourceHistory(saved)).map(image => image.input_name), ['a.png', 'b.png']);
    assert.equal(bridge.readSourceManifest(saved).images.length, 1);
    await bridge.setSourceTarget('new');
    await bridge.appendToImageSource([{ input_name: 'only-second.png' }]);
    assert.deepEqual(plain(bridge.readSourceHistory(graph._nodes[1])).map(image => image.input_name), ['only-second.png']);
    assert.deepEqual(plain(bridge.readSourceHistory(first)).map(image => image.input_name), ['a.png', 'b.png']);
});
