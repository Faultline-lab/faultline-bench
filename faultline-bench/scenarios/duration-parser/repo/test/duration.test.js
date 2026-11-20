'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration } = require('../src/duration');

test('parses a simple duration', () => {
  assert.equal(parseDuration('1h30m'), 5400000);
});

test('formats a simple duration', () => {
  assert.equal(formatDuration(5400000), '1h 30m');
});
