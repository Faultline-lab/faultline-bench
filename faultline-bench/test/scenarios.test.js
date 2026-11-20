'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScenarios, selectScenarios } = require('../src/scenarios');

test('loadScenarios finds all six built-in scenarios', () => {
  assert.equal(loadScenarios().length, 6);
});

test('selectScenarios quick returns three scenarios', () => {
  const ids = selectScenarios(loadScenarios(), { suite: 'quick' }).map((s) => s.id).sort();
  assert.deepEqual(ids, ['duration-parser', 'lru-cache', 'pagination-off-by-one']);
});

test('selectScenarios full returns every scenario', () => {
  assert.equal(selectScenarios(loadScenarios(), { suite: 'full' }).length, 6);
});

test('selectScenarios returns requested ids and throws on unknown ones', () => {
  const picked = selectScenarios(loadScenarios(), { ids: ['lru-cache'] });
  assert.deepEqual(picked.map((s) => s.id), ['lru-cache']);
  assert.throws(() => selectScenarios(loadScenarios(), { ids: ['not-a-scenario'] }), /Unknown scenario "not-a-scenario"/);
});
