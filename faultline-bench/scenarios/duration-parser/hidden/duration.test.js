'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration } = require('../src/duration');

test('single units', () => {
  assert.equal(parseDuration('250ms'), 250);
  assert.equal(parseDuration('2s'), 2000);
  assert.equal(parseDuration('3m'), 180000);
  assert.equal(parseDuration('1h'), 3600000);
  assert.equal(parseDuration('1d'), 86400000);
});

test('combined parts with and without spaces', () => {
  assert.equal(parseDuration('1h30m'), 5400000);
  assert.equal(parseDuration('1h 30m'), 5400000);
  assert.equal(parseDuration('2d 4h'), 187200000);
  assert.equal(parseDuration('1m 1s 1ms'), 61001);
});

test('any order', () => {
  assert.equal(parseDuration('30m1h'), 5400000);
});

test('decimals', () => {
  assert.equal(parseDuration('1.5h'), 5400000);
  assert.equal(parseDuration('0.5s'), 500);
});

test('case-insensitive and trimmed', () => {
  assert.equal(parseDuration('  1H 30M  '), 5400000);
  assert.equal(parseDuration('10MS'), 10);
});

test('plain number is milliseconds', () => {
  assert.equal(parseDuration('500'), 500);
});

test('rounds to the nearest millisecond', () => {
  assert.equal(parseDuration('1.0006s'), 1001);
});

test('ms is not confused with m', () => {
  assert.equal(parseDuration('5ms'), 5);
  assert.equal(parseDuration('5m'), 300000);
});

test('non-string input throws TypeError', () => {
  assert.throws(() => parseDuration(5), TypeError);
  assert.throws(() => parseDuration(null), TypeError);
});

test('invalid strings throw RangeError', () => {
  for (const bad of ['', '   ', 'h', '1x', '1h foo', '1hh', '-1h', '1h 1h', 'abc']) {
    assert.throws(() => parseDuration(bad), RangeError, `expected RangeError for ${JSON.stringify(bad)}`);
  }
});

test('formatDuration basics', () => {
  assert.equal(formatDuration(5400000), '1h 30m');
  assert.equal(formatDuration(90061001), '1d 1h 1m 1s 1ms');
  assert.equal(formatDuration(1000), '1s');
  assert.equal(formatDuration(86400000), '1d');
});

test('formatDuration zero and rounding', () => {
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(1499.6), '1s 500ms');
});

test('formatDuration invalid input', () => {
  assert.throws(() => formatDuration(-1), RangeError);
  assert.throws(() => formatDuration(NaN), RangeError);
  assert.throws(() => formatDuration(Infinity), RangeError);
  assert.throws(() => formatDuration('5'), TypeError);
});

test('round trip', () => {
  for (const s of ['1d 2h 3m 4s 5ms', '7h', '59m 59s']) {
    assert.equal(formatDuration(parseDuration(s)), s);
  }
});
