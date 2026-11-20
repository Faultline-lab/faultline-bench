'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Emitter } = require('../src/emitter');

test('on and emit', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', (a, b) => seen.push(a + b));
  assert.equal(e.emit('x', 1, 2), true);
  assert.deepEqual(seen, [3]);
});

test('once runs one time', () => {
  const e = new Emitter();
  let n = 0;
  e.once('x', () => n++);
  e.emit('x');
  e.emit('x');
  assert.equal(n, 1);
});
