// Run: node --test tests/prompt_resolution.test.cjs (after installing web dependencies).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const R = load('PromptResolution');
const B = load('PromptBoxes');
const { extractLocalPrompts } = load('LocalImageSearch');
const { promptTags } = load('PromptTags');
const M = B.SOURCE_MARKER;

test('the picked option of every group is inferred from the resolved prompt', () => {
    const choices = R.inferChoices('1girl, {blond hair|red hair|black hair}, {long hair|short hair|}, {smile, open mouth|}, standing', '1girl, red hair, smile, open mouth, standing');
    assert.deepEqual(choices.map(c => [c.kind, c.chosen]), [['alternatives', 'red hair'], ['optional', ''], ['group', 'smile, open mouth']]);
    // Weights, underscores and extra tags at the end (source text) do not break the match.
    assert.deepEqual(R.inferChoices('({a_b|c}:1.2), d', '(a b:1.2), d, from source').map(c => c.chosen), ['a_b']);
});

test('groups whose pick is unknown are left out of tags entirely', () => {
    assert.equal(R.stripUnresolved('a, {blond hair|red hair}, (b:1.2), {c, d|}, e'), 'a, (b:1.2), e');
    assert.deepEqual(promptTags('a, {x|y}, b', 'positive_prompt'), ['positive_prompt:a', 'positive_prompt:b']);
});

test('the encoder record wins over the raw inputs and the workflow boxes give per-group picks', () => {
    const boxes = B.stateFromText('1girl, {blond hair|red hair}', 'after', true);
    const metadata = {
        prompt: {
            '3': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0] } },
            '6': { class_type: 'GalleryPromptEncode', inputs: { text: '1girl, ' + M, source_text: ['9', 0], source_mode: 'boxes' } },
            '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
        },
        workflow: { nodes: [{ id: 6, type: 'GalleryPromptEncode', title: 'Encoder', properties: { prompt_boxes: boxes } }] },
        gallery_prompts: { '6': { text: '1girl, {blond hair|red hair}, {tall|short}', resolved: '1girl, blond hair, short', source_text: '{tall|short}' } },
    };
    assert.equal(extractLocalPrompts(metadata).positive, '1girl, blond hair, short');
    const [resolution] = R.promptResolutions(metadata);
    assert.equal(resolution.title, 'Encoder');
    assert.deepEqual(resolution.choices.map(c => c.chosen), ['blond hair', 'short']);
    // The same metadata read back from a Hydrus note.
    const note = { hydrus: { notes: { 'ComfyUI Gallery generation metadata': JSON.stringify(metadata) } } };
    assert.equal(extractLocalPrompts(note).positive, '1girl, blond hair, short');
});

test('the source marker of a box layout never becomes part of the extracted prompt', () => {
    const metadata = { prompt: {
        '3': { class_type: 'KSampler', inputs: { positive: ['6', 0] } },
        '6': { class_type: 'GalleryPromptEncode', inputs: { text: 'a, b, ' + M + ', c', source_text: ['9', 0], source_mode: 'boxes' } },
        '9': { class_type: 'String', inputs: { value: 'from source' } },
    } };
    assert.deepEqual(extractLocalPrompts(metadata).positive.split('\n'), ['a, b', 'from source', 'c']);
});
