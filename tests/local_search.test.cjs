// Run: node tests/local_search.test.cjs (after installing web dependencies).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
const filename = path.resolve(__dirname, '../web/src/LocalImageSearch.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
vm.runInThisContext(`(function(exports,module){${source}\n})`, { filename })(compiled.exports, compiled);
const { extractLocalPrompts, extractHydrusTags, matchesLocalImage } = compiled.exports;
const tagSource = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../web/src/PromptTags.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const tagModule = { exports: {} };
vm.runInThisContext(`(function(exports,module){${tagSource}\n})`)(tagModule.exports, tagModule);
const { promptTags } = tagModule.exports;

test('prompt tags keep positive and negative phrases separately namespaced without splitting prose', () => {
    assert.deepEqual(promptTags(' blue sky, mountain\nblue sky,, a long sentence about a forest. ', 'positive_prompt'),
        ['positive_prompt:blue sky', 'positive_prompt:mountain', 'positive_prompt:a long sentence about a forest.']);
    assert.deepEqual(promptTags('blurry, watermark', 'negative_prompt'), ['negative_prompt:blurry', 'negative_prompt:watermark']);
    assert.deepEqual(promptTags('', 'positive_prompt'), []);
    assert.deepEqual(promptTags('blue sky, mountain\nblue sky', ''), ['blue sky', 'mountain']);
});

function apiFixture() {
    return {
        '81': { class_type: 'CLIPTextEncode', inputs: { text: 'A blurry shadow in a forest' } },
        '82': { class_type: 'CLIPTextEncode', inputs: { text: 'bright sunshine, watermark' } },
        '700': { class_type: 'KSampler', inputs: { positive: ['81', 0], negative: ['82', 0], model: ['90', 0] } },
        '90': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'not-a-prompt.safetensors' } },
    };
}

test('arbitrary API node IDs preserve conditioning polarity rather than guessing from words', () => {
    assert.deepEqual(extractLocalPrompts({ prompt: apiFixture() }), {
        positive: 'A blurry shadow in a forest', negative: 'bright sunshine, watermark',
    });
});

test('JSON-string metadata resolves linked text and combined conditioning without loops', () => {
    const prompt = apiFixture();
    prompt['81'].inputs.text = [501, 0];
    prompt['501'] = { class_type: 'PrimitiveString', inputs: { value: 'moonlit pond' } };
    prompt['503'] = { class_type: 'CLIPTextEncode', inputs: { text: 'snowy forest' } };
    prompt['504'] = { class_type: 'ConditioningCombine', inputs: { conditioning_1: ['81', 0], conditioning_2: ['503', 0], conditioning_3: ['504', 0] } };
    prompt['700'].inputs.positive = ['504', 0];
    assert.deepEqual(extractLocalPrompts({ prompt: JSON.stringify(prompt) }), {
        positive: 'moonlit pond\nsnowy forest', negative: 'bright sunshine, watermark',
    });
});

test('workflow-only links resolve CLIP widgets and preserve separate negative text', () => {
    assert.deepEqual(extractLocalPrompts({ workflow: JSON.stringify({
        nodes: [
            { id: 9, type: 'CLIPTextEncode', widgets_values: ['rainy city'] },
            { id: 22, type: 'CLIPTextEncode', widgets_values: ['crowds'] },
            { id: 70, type: 'KSampler', inputs: [{ name: 'positive', link: 31 }, { name: 'negative', link: 32 }] },
        ],
        links: [[31, 9, 0, 70, 0, 'CONDITIONING'], [32, 22, 0, 70, 1, 'CONDITIONING']],
    }) }), { positive: 'rainy city', negative: 'crowds' });
});

test('API conditioning takes precedence over unrelated labelled nodes and saved workflow', () => {
    const prompt = apiFixture();
    prompt['200'] = { class_type: 'CLIPTextEncode', inputs: { text: 'stale disconnected prompt' }, _meta: { title: 'Positive Prompt' } };
    const found = extractLocalPrompts({ prompt, workflow: { nodes: [{ id: 5, type: 'CLIPTextEncode', title: 'Positive Prompt', widgets_values: ['stale workflow'] }] } });
    assert.equal(found.positive, 'A blurry shadow in a forest');
});

test('direct fields, parameters, and BasicGuider conditioning have explicit polarity', () => {
    assert.deepEqual(extractLocalPrompts({ prompt: '{"positive":"red sky","negative":"blue"}' }), { positive: 'red sky', negative: 'blue' });
    assert.deepEqual(extractLocalPrompts({ parameters: 'red sky\nNegative prompt: blue\nSteps: 20, Sampler: Euler' }), { positive: 'red sky', negative: 'blue' });
    assert.deepEqual(extractLocalPrompts({ prompt: { 3: { class_type: 'BasicGuider', inputs: { conditioning: [4, 0] } }, 4: { class_type: 'CLIPTextEncode', inputs: { text: 'green hills' } } } }), { positive: 'green hills', negative: '' });
});

test('Flux encoder follows both text inputs including a linked string into BasicGuider', () => {
    assert.deepEqual(extractLocalPrompts({ prompt: {
        3: { class_type: 'BasicGuider', inputs: { conditioning: [4, 0] } },
        4: { class_type: 'CLIPTextEncodeFlux', inputs: { clip_l: 'green hills', t5xxl: [5, 0], guidance: 3.5 } },
        5: { class_type: 'PrimitiveString', inputs: { value: 'a river through the valley' } },
    } }), { positive: 'green hills\na river through the valley', negative: '' });
});

test('SD3 encoder preserves polarity for all three prompt inputs without indexing padding options', () => {
    assert.deepEqual(extractLocalPrompts({ prompt: {
        3: { class_type: 'KSampler', inputs: { positive: [4, 0], negative: [5, 0] } },
        4: { class_type: 'CLIPTextEncodeSD3', inputs: { clip_l: 'green hills', clip_g: 'spring landscape', t5xxl: 'green hills', empty_padding: 'empty_prompt' } },
        5: { class_type: 'CLIPTextEncodeSD3', inputs: { clip_l: 'watermark', clip_g: 'blur', t5xxl: 'bad detail', empty_padding: 'none' } },
    } }), { positive: 'green hills\nspring landscape', negative: 'watermark\nblur\nbad detail' });
});

test('workflow-only Flux and SD3 encoder widgets exclude their non-prompt settings', () => {
    assert.deepEqual(extractLocalPrompts({ workflow: {
        nodes: [
            { id: 9, type: 'CLIPTextEncodeFlux', widgets_values: ['rainy city', 'night skyline', 3.5] },
            { id: 22, type: 'CLIPTextEncodeSD3', widgets_values: ['crowds', 'cars', 'traffic', 'empty_prompt'] },
            { id: 70, type: 'KSampler', inputs: [{ name: 'positive', link: 31 }, { name: 'negative', link: 32 }] },
        ],
        links: [[31, 9, 0, 70, 0, 'CONDITIONING'], [32, 22, 0, 70, 1, 'CONDITIONING']],
    } }), { positive: 'rainy city\nnight skyline', negative: 'crowds\ncars\ntraffic' });
});

test('malformed metadata and disconnected unlabelled text never become inferred prompts', () => {
    for (const metadata of [null, {}, { prompt: '{invalid' }, { prompt: { 7: { class_type: 'CLIPTextEncode', inputs: { text: 'best quality' } } } }]) {
        assert.deepEqual(extractLocalPrompts(metadata), { positive: '', negative: '' });
    }
});

test('Hydrus search indexes active and pending display/storage tags across services, not deleted tags', () => {
    assert.deepEqual(extractHydrusTags({ tags: {
        serviceA: { display_tags: { 0: ['character:Alice', 'blue hair'], 1: ['deleted tag'], 2: ['pending tag'] }, storage_tags: { 0: ['alias:alice', 'blue hair'] } },
        serviceB: { storage_tags: { 0: ['series:Example'], 3: ['petitioned only'] } },
    } }), ['character:Alice', 'blue hair', 'pending tag', 'alias:alice', 'series:Example']);
});

test('local search is case-insensitive and field-specific, including namespaced Hydrus tags', () => {
    const file = { name: 'Example.PNG', metadata: { prompt: apiFixture() } };
    const tags = ['character:Alice'];
    assert.equal(matchesLocalImage(file, ' ALICE ', 'hydrus', tags), true);
    assert.equal(matchesLocalImage(file, 'ALICE', 'positive', tags), false);
    assert.equal(matchesLocalImage(file, 'blurry shadow', 'positive', tags), true);
    assert.equal(matchesLocalImage(file, 'blurry shadow', 'negative', tags), false);
    assert.equal(matchesLocalImage(file, 'bright sunshine', 'negative', tags), true);
    assert.equal(matchesLocalImage(file, 'Example', 'name', tags), true);
    assert.equal(matchesLocalImage(file, 'forest', 'all', tags), true);
    assert.equal(matchesLocalImage(file, 'character:Alice', 'all', tags), true);
    assert.equal(matchesLocalImage(file, ' ', 'all', tags), true);
});
