'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Cache } = require('../src/cache');

test('stores and returns values', () => {
  const c = new Cache();
  c.set('a', 1).set('b', 2);
  assert.equal(c.get('a'), 1);
  assert.equal(c.size, 2);
});

test('evicts the least recently used entry', () => {
  const c = new Cache({ maxSize: 2 });
  c.set('a', 1).set('b', 2).set('c', 3);
  assert.equal(c.has('a'), false);
  assert.equal(c.size, 2);
});
