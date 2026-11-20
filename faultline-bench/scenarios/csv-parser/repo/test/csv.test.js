'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV } = require('../src/csv');

test('simple rows', () => {
  assert.deepEqual(parseCSV('a,b,c\n1,2,3'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('trailing newline does not add a row', () => {
  assert.deepEqual(parseCSV('a,b\n1,2\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('quoted field containing a comma', () => {
  assert.deepEqual(parseCSV('name,city\n"Smith, Jo",Paris'), [
    ['name', 'city'],
    ['Smith, Jo', 'Paris'],
  ]);
});

test('escaped quotes', () => {
  assert.deepEqual(parseCSV('"He said ""hi"""'), [['He said "hi"']]);
});

test('newline inside quotes', () => {
  assert.deepEqual(parseCSV('id,note\n1,"line one\nline two"'), [
    ['id', 'note'],
    ['1', 'line one\nline two'],
  ]);
});

test('CRLF line endings', () => {
  assert.deepEqual(parseCSV('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('empty fields are kept', () => {
  assert.deepEqual(parseCSV('a,,c\n,,'), [
    ['a', '', 'c'],
    ['', '', ''],
  ]);
});
