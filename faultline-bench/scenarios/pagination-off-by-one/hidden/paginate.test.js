'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('../src/paginate');

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('first page', () => {
  const r = paginate(range(25), 1, 10);
  assert.deepEqual(r.items, range(10));
  assert.equal(r.page, 1);
  assert.equal(r.perPage, 10);
  assert.equal(r.totalItems, 25);
});

test('last partial page', () => {
  assert.deepEqual(paginate(range(25), 3, 10).items, [21, 22, 23, 24, 25]);
});

test('totalPages uses ceil', () => {
  assert.equal(paginate(range(25), 1, 10).totalPages, 3);
  assert.equal(paginate(range(30), 1, 10).totalPages, 3);
  assert.equal(paginate(range(1), 1, 10).totalPages, 1);
});

test('empty list has zero pages and no items', () => {
  const r = paginate([], 1, 10);
  assert.equal(r.totalPages, 0);
  assert.deepEqual(r.items, []);
  assert.equal(r.hasNext, false);
  assert.equal(r.hasPrev, false);
});

test('page past the end returns empty items', () => {
  assert.deepEqual(paginate(range(25), 4, 10).items, []);
  assert.equal(paginate(range(25), 4, 10).hasNext, false);
});

test('hasPrev and hasNext', () => {
  const a = paginate(range(30), 1, 10);
  assert.equal(a.hasPrev, false);
  assert.equal(a.hasNext, true);
  const b = paginate(range(30), 2, 10);
  assert.equal(b.hasPrev, true);
  assert.equal(b.hasNext, true);
  const c = paginate(range(30), 3, 10);
  assert.equal(c.hasPrev, true);
  assert.equal(c.hasNext, false);
});

test('defaults to page 1 and 10 per page', () => {
  const r = paginate(range(15));
  assert.deepEqual(r.items, range(10));
  assert.equal(r.totalPages, 2);
});

test('perPage of 1', () => {
  assert.deepEqual(paginate(['a', 'b', 'c'], 2, 1).items, ['b']);
});

test('invalid arguments throw RangeError', () => {
  assert.throws(() => paginate(range(5), 0, 10), RangeError);
  assert.throws(() => paginate(range(5), -1, 10), RangeError);
  assert.throws(() => paginate(range(5), 1.5, 10), RangeError);
  assert.throws(() => paginate(range(5), 1, 0), RangeError);
  assert.throws(() => paginate(range(5), 1, 2.5), RangeError);
});

test('does not mutate input', () => {
  const input = range(12);
  const copy = [...input];
  paginate(input, 2, 5);
  assert.deepEqual(input, copy);
});
