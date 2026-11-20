'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('../src/paginate');

const items = Array.from({ length: 25 }, (_, i) => i + 1);

test('first page returns the first perPage items', () => {
  const r = paginate(items, 1, 10);
  assert.deepEqual(r.items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(r.totalPages, 3);
});
