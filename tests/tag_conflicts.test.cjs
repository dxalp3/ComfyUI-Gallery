const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./ts_loader.cjs');
const T = load('TagConflicts.ts');
T.setExclusiveSets(require('../data/exclusive-tags.json').sets);

test('exclusive tag sets compare names loosely and leave unrelated tags alone', () => {
    assert.equal(T.conflicts('long hair', 'short_hair'), true);
    assert.equal(T.conflicts('(Long Hair:1.2)', 'very long hair'), true);
    assert.equal(T.conflicts('long hair', 'long_hair'), false);
    assert.equal(T.conflicts('long hair', 'blue eyes'), false);
    assert.equal(T.conflicts('multicolored hair', 'red hair'), false);
    assert.ok(T.conflictsOf('1girl').includes('2girls'));
});

test('set files in JSON or text shapes are read', () => {
    const names = sets => sets.map(set => set.name + ':' + set.tags.join('/'));
    assert.deepEqual(names(T.parseExclusiveSets('[["a","b"],["c"]]')), [':a/b']);
    assert.deepEqual(names(T.parseExclusiveSets('{"sets":[{"label":"Hair","members":["short hair","long hair"]}]}')), ['Hair:short hair/long hair']);
    assert.deepEqual(names(T.parseExclusiveSets('{"Framing":["portrait","full body"],"Mood":{"tags":["happy","sad","happy"]}}')), ['Framing:portrait/full body', 'Mood:happy/sad']);
    assert.deepEqual(names(T.parseExclusiveSets('# comment\nHair length: short hair, long hair\nday | night\nlonely')), ['Hair length:short hair/long hair', ':day/night']);
    T.setExclusiveSets([{ name: 'x', tags: ['day', 'night'] }]);
    assert.equal(T.conflicts('day', 'night'), true);
    assert.equal(T.conflicts('long hair', 'short hair'), false, 'a new list replaces the old one');
});
