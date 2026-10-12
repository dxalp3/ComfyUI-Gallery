const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const { emptyGroup, parsePrompt, compileChip, compileBoxes } = load('PromptBoxes');
const { dropPromptChip } = load('PromptDrag');
const { promptTerms, promptTags } = load('PromptTags');
const { extractLocalPrompts } = load('LocalImageSearch');

test('chip drops move locally and copy across editors without flattening groups', () => {
    const chip = parsePrompt('({red, blue|green|}:1.2)')[0];
    const a = emptyGroup('A', [chip]), b = emptyGroup('B', parsePrompt('tail'));
    const state = { version: 1, boxes: [a, b] };
    const moved = dropPromptChip(state, chip, b.id, { chipId: b.chips[0].id, after: false });
    assert.equal(moved.boxes[0].chips.length, 0);
    assert.equal(moved.boxes[1].chips[0].id, chip.id);
    const separate = { version: 1, boxes: [b] };
    const copied = dropPromptChip(separate, chip, b.id);
    assert.notEqual(copied.boxes[0].chips[1].id, chip.id);
    assert.equal(compileChip(copied.boxes[0].chips[1]), compileChip(chip));
    assert.equal(state.boxes[0].chips.length, 1);
});

test('editable prompt terms retain alternates, optional groups, brackets and newlines', () => {
    const text = 'plain, {red|blue}, {a, b|}, {c|}, [soft], (detail:1.2)\nlast';
    assert.deepEqual(promptTerms(text), ['plain', '{red|blue}', '{a, b|}', '{c|}', '[soft]', '(detail:1.2)', 'last']);
    assert.deepEqual(promptTerms('{a,\nb|}, tail'), ['{a,\nb|}', 'tail']);
    assert(!promptTags(text, '').some(term => term.includes('red')));
});

test('prefix reuse recovers the template without changing search/export resolved prompts', () => {
    const state = { version: 1, boxes: [emptyGroup('Tags', parsePrompt('plain, {red|blue}, {a, b|}, [soft]'))] };
    const metadata = {
        prompt: { '1': { class_type: 'GalleryPromptEncode', inputs: { text: 'plain, blue, [soft]' } }, '2': { class_type: 'KSampler', inputs: { positive: ['1', 0] } } },
        workflow: { nodes: [{ id: 1, type: 'GalleryPromptEncode', properties: { prompt_boxes: state } }] },
        gallery_prompts: { '1': { text: 'plain, {red|blue}, {a, b|}, [soft]', resolved: 'plain, blue, [soft]' } }
    };
    assert.equal(extractLocalPrompts(metadata).positive, 'plain, blue, [soft]');
    assert.equal(extractLocalPrompts(metadata, true).positive, compileBoxes(state));
    assert.equal(extractLocalPrompts({ positive: 'only resolved' }, true).positive, 'only resolved');
});


test('copied workflows with matching chip IDs still copy across editors', () => {
    const original = parsePrompt('source')[0];
    const box = emptyGroup('Cloned node', [{ ...original }]);
    const state = { version: 1, boxes: [box] };
    const next = dropPromptChip(state, original, box.id);
    assert.equal(next.boxes[0].chips.length, 2);
    assert.notEqual(next.boxes[0].chips[0].id, next.boxes[0].chips[1].id);
});
