const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../web/node_modules/typescript');
const compiled = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('web/src/PromptBoxes.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInThisContext(`(function(exports,module){${source}})`)(compiled.exports, compiled);
const B = compiled.exports;
const M = B.SOURCE_MARKER;
const round = text => B.parsePrompt(text).map(B.compileChip);

test('comma-separated tags become individual chips and keep their weights and brackets', () => {
    assert.deepEqual(round('a, b, (c:1.2), [d], (e)'), ['a', 'b', '(c:1.2)', '[d]', '(e)']);
    assert.equal(B.parsePrompt('(a, b:1.2), {c, d|e}, <lora:x:0.8>, f').length, 4);
    assert.equal(B.parsePrompt('  , ,').length, 0);
});

test('{a|b|c} is an or-chip and a trailing pipe makes it optional', () => {
    const chips = B.parsePrompt('{a|b|c}, {d, e|f|}, ({g|h}:1.3)');
    assert.deepEqual(chips.map(chip => chip.kind), ['or', 'or', 'or']);
    assert.deepEqual([chips[0].options, chips[0].optional], [['a', 'b', 'c'], false]);
    assert.deepEqual([chips[1].options, chips[1].optional], [['d, e', 'f'], true]);
    assert.equal(chips[2].weight, 1.3);
    assert.equal(chips.map(B.compileChip).join(', '), '{a|b|c}, {d, e|f|}, ({g|h}:1.3)');
});

test('disabled chips and boxes are left out of the compiled prompt', () => {
    const state = B.stateFromText('a, b, c');
    state.boxes[0].chips[1].enabled = false;
    assert.equal(B.compileBoxes(state), 'a, c, ' + M);
    state.boxes[1].enabled = false;
    assert.equal(B.compileBoxes(state), 'a, c');
    state.boxes[0].enabled = false;
    assert.equal(B.compileBoxes(state), '');
});

test('workflows from before the box editor keep their source order', () => {
    assert.equal(B.compileBoxes(B.stateFromText('a, b', 'after', true)), 'a, b, ' + M);
    assert.equal(B.compileBoxes(B.stateFromText('a, b', 'before', true)), M + ', a, b');
    assert.equal(B.compileBoxes(B.stateFromText('a, b', 'replace', true)), M);
    assert.equal(B.compileBoxes(B.stateFromText('a, b', 'boxes', true)), 'a, b');
    const split = B.stateFromText('a, ' + M + ', b');
    assert.deepEqual(split.boxes.map(box => box.kind), ['group', 'source', 'group']);
    assert.deepEqual(split.boxes.filter(box => box.kind === 'group').map(box => box.name), ['#1', '#2']);
    assert.equal(B.compileBoxes(split), 'a, ' + M + ', b');
});

test('text changed outside the editor is adopted, unchanged text keeps the boxes', () => {
    const state = B.stateFromText('a');
    assert.equal(B.reconcileText(state, B.compileBoxes(state), 'boxes', true), state);
    const adopted = B.reconcileText(state, 'x, y', 'boxes', true);
    assert.notEqual(adopted, state);
    assert.equal(B.compileBoxes(adopted), 'x, y');
});

test('library appends become boxes named after the prefix, otherwise #1, #2', () => {
    const base = B.stateFromText('a');
    const after = B.insertText(base, 'b, c', 'after', 'Portrait');
    assert.deepEqual(after.boxes.map(box => box.kind === 'group' ? box.name : 'source'), ['#1', 'source', 'Portrait']);
    assert.equal(B.compileBoxes(after), 'a, ' + M + ', b, c');
    const before = B.insertText(base, 'z', 'before');
    assert.equal(before.boxes[0].name, '#2');
    assert.equal(B.compileBoxes(before), 'z, a, ' + M);
    assert.equal(B.compileBoxes(B.insertText(base, 'q', 'replace', 'New')), 'q, ' + M);
    assert.equal(B.insertText(base, ' , ', 'after'), base);
});

test('the backend substitution is mirrored for the preview', () => {
    assert.equal(B.composeWithSource('a, ' + M + ', b', 'x, y,'), 'a, x, y, b');
    assert.equal(B.composeWithSource('a, ' + M, undefined), 'a');
    assert.equal(B.composeWithSource(M + ', a', 'src'), 'src, a');
});

test('saved state is validated and always has exactly one source box', () => {
    assert.equal(B.parseState(null), undefined);
    assert.equal(B.parseState({ version: 2, boxes: [] }), undefined);
    const state = B.parseState({ version: 1, boxes: [{ kind: 'group', name: 'x', chips: [{ kind: 'tag', text: 'a' }, { kind: 'bogus' }, { kind: 'or', options: [] }] }] });
    assert.deepEqual(state.boxes.map(box => box.kind), ['group', 'source']);
    assert.equal(state.boxes[0].chips.length, 1);
    assert.equal(B.parseState({ version: 1, boxes: [{ kind: 'source' }, { kind: 'source' }] }).boxes.length, 1);
});

test('boxes can be reordered and renamed, but the source box cannot be deleted', () => {
    const base = B.stateFromText('a');
    const [own, src] = base.boxes;
    assert.deepEqual(B.moveBox(base, own.id, 1).boxes.map(box => box.id), [src.id, own.id]);
    assert.equal(B.moveBox(base, own.id, -1), base);
    assert.equal(B.removeBox(base, src.id).boxes.length, 2);
    assert.equal(B.removeBox(base, own.id).boxes.length, 1);
    assert.equal(B.updateBox(base, own.id, { name: 'Pose' }).boxes[0].name, 'Pose');
    assert.equal(B.nextName(base), '#2');
});

test('a comma only ends a tag while no bracket is open', () => {
    assert.equal(B.balanced('a'), true);
    assert.equal(B.balanced('{a, b'), false);
    assert.equal(B.balanced('(a:1.2)'), true);
});

test('chips drag between boxes and boxes drag into place', () => {
    let state = B.addBox(B.stateFromText('a, b, c'), 'Other', 'x, y');
    const [own, src, other] = state.boxes;
    const [a, b, c] = own.chips;
    const [x] = other.chips;
    state = B.moveChipTo(state, c.id, own.id, { chipId: a.id, after: false });
    assert.equal(B.compileBoxes(state), 'c, a, b, ' + M + ', x, y');
    state = B.moveChipTo(state, a.id, other.id, { chipId: x.id, after: true });
    assert.equal(B.compileBoxes(state), 'c, b, ' + M + ', x, a, y');
    state = B.moveChipTo(state, c.id, other.id);
    assert.equal(B.compileBoxes(state), 'b, ' + M + ', x, a, y, c');
    // Dropping a chip on itself, into the source box or into a box that does not exist changes nothing.
    assert.equal(B.moveChipTo(state, b.id, other.id, { chipId: b.id, after: true }), state);
    assert.equal(B.moveChipTo(state, b.id, src.id), state);
    assert.equal(B.moveChipTo(state, b.id, 'missing'), state);
    state = B.moveBoxTo(state, other.id, { boxId: own.id, after: false });
    assert.deepEqual(state.boxes.map(box => box.id), [other.id, own.id, src.id]);
    state = B.moveBoxTo(state, own.id, { boxId: src.id, after: true });
    assert.deepEqual(state.boxes.map(box => box.id), [other.id, src.id, own.id]);
    assert.equal(B.moveBoxTo(state, own.id, { boxId: own.id, after: true }), state);
});

test('the four grouping kinds are named, converted, merged and split', () => {
    const [tag, alt, opt, group] = B.parsePrompt('a, {b|c}, {d|e|}, {f, g|}');
    assert.deepEqual([tag, alt, opt, group].map(B.groupingKind), ['tag', 'alternatives', 'optional', 'group']);
    assert.equal(B.compileChip(B.setGroupingKind(alt, 'optional')), '{b|c|}');
    assert.equal(B.compileChip(B.setGroupingKind(alt, 'group')), '{b, c|}');
    assert.equal(B.compileChip(B.setGroupingKind(group, 'alternatives')), '{f|g}');
    assert.equal(B.compileChip(B.setGroupingKind(tag, 'optional')), '{a|}');
    assert.equal(B.compileChip(B.setGroupingKind(opt, 'tag')), 'd, e');
    // A single required option is plain text, not `{a}`.
    assert.equal(B.compileChip({ id: 'x', kind: 'or', options: ['a'], optional: false, enabled: true, weight: 1.2 }), '(a:1.2)');
    let state = B.stateFromText('a, b, c', 'after', true);
    const ids = state.boxes[0].chips.map(chip => chip.id);
    state = B.mergeChips(state, state.boxes[0].id, [ids[0], ids[2]], 'alternatives');
    assert.equal(B.compileBoxes(state), '{a|c}, b, ' + M);
    state = B.splitChip(state, state.boxes[0].id, state.boxes[0].chips[0].id);
    assert.equal(B.compileBoxes(state), 'a, c, b, ' + M);
});

test('suggestions follow the word being typed, also inside braces', () => {
    assert.deepEqual(B.typingToken('x, {blond hair|bro'), { token: 'bro', start: 15, inGroup: true });
    assert.deepEqual(B.typingToken('x, re'), { token: 're', start: 3, inGroup: false });
    assert.equal(B.typingToken('{a|b}, c').inGroup, false);
    assert.equal(B.closeBraces('{a|{b|c'), '{a|{b|c}}');
});

test('"Add as" turns typed tags into one chip of the chosen kind', () => {
    assert.equal(B.compileChip(B.groupChip('alternatives', ['a', 'b', 'a'])), '{a|b}');
    assert.equal(B.compileChip(B.groupChip('optional', ['a', 'b'])), '{a|b|}');
    assert.equal(B.compileChip(B.groupChip('group', ['a', 'b'])), '{a, b|}');
    assert.equal(B.groupChip('group', [' ']), undefined);
    const state = B.addBoxWithChip(B.stateFromText('x'), B.groupChip('group', ['a', 'b']));
    assert.equal(B.compileBoxes(state), 'x, ' + M + ', {a, b|}');
});
