'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Cache } = require('../src/cache');

test('unbounded cache still works with no arguments', () => {
  const c = new Cache();
  for (let i = 0; i < 1000; i++) c.set(i, i * 2);
  assert.equal(c.size, 1000);
  assert.equal(c.get(500), 1000);
  assert.equal(c.get('missing'), undefined);
});

test('set returns this for chaining', () => {
  const c = new Cache({ maxSize: 3 });
  assert.equal(c.set('a', 1), c);
});

test('evicts least recently used on overflow', () => {
  const c = new Cache({ maxSize: 2 });
  c.set('a', 1).set('b', 2).set('c', 3);
  assert.deepEqual(c.keys(), ['b', 'c']);
  assert.equal(c.get('a'), undefined);
});

test('get refreshes recency', () => {
  const c = new Cache({ maxSize: 2 });
  c.set('a', 1).set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.deepEqual(c.keys(), ['a', 'c']);
});

test('set of existing key refreshes recency and updates value', () => {
  const c = new Cache({ maxSize: 2 });
  c.set('a', 1).set('b', 2).set('a', 10).set('c', 3);
  assert.deepEqual(c.keys(), ['a', 'c']);
  assert.equal(c.get('a'), 10);
});

test('has does not refresh recency', () => {
  const c = new Cache({ maxSize: 2 });
  c.set('a', 1).set('b', 2);
  assert.equal(c.has('a'), true);
  c.set('c', 3);
  assert.equal(c.has('a'), false);
});

test('onEvict is called only for evictions', () => {
  const evicted = [];
  const c = new Cache({ maxSize: 2, onEvict: (k, v) => evicted.push([k, v]) });
  c.set('a', 1).set('b', 2).set('b', 20).set('c', 3);
  assert.deepEqual(evicted, [['a', 1]]);
  c.delete('b');
  c.clear();
  assert.deepEqual(evicted, [['a', 1]]);
});

test('delete and clear', () => {
  const c = new Cache({ maxSize: 5 });
  c.set('a', 1).set('b', 2);
  assert.equal(c.delete('a'), true);
  assert.equal(c.delete('a'), false);
  assert.equal(c.size, 1);
  c.clear();
  assert.equal(c.size, 0);
  assert.deepEqual(c.keys(), []);
});

test('keys ordered least to most recently used', () => {
  const c = new Cache({ maxSize: 10 });
  c.set(1, 'x').set(2, 'y').set(3, 'z');
  c.get(1);
  assert.deepEqual(c.keys(), [2, 3, 1]);
});

test('maxSize 1', () => {
  const c = new Cache({ maxSize: 1 });
  c.set('a', 1).set('b', 2);
  assert.deepEqual(c.keys(), ['b']);
});

test('stores falsy values and undefined keys correctly', () => {
  const c = new Cache({ maxSize: 3 });
  c.set('zero', 0).set('empty', '').set('no', false);
  assert.equal(c.get('zero'), 0);
  assert.equal(c.get('empty'), '');
  assert.equal(c.get('no'), false);
  assert.equal(c.size, 3);
});

test('invalid maxSize throws RangeError', () => {
  for (const bad of [0, -1, 1.5, NaN, '3']) {
    assert.throws(() => new Cache({ maxSize: bad }), RangeError, `maxSize ${String(bad)}`);
  }
  assert.doesNotThrow(() => new Cache({ maxSize: Infinity }));
});
