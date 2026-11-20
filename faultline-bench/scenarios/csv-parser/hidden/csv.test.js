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

test('CRLF line endings, including inside quotes', () => {
  assert.deepEqual(parseCSV('a,b\r\n1,"x\r\ny"\r\n'), [
    ['a', 'b'],
    ['1', 'x\r\ny'],
  ]);
});

test('empty fields are kept', () => {
  assert.deepEqual(parseCSV('a,,c\n,,'), [
    ['a', '', 'c'],
    ['', '', ''],
  ]);
});

test('empty input returns no rows', () => {
  assert.deepEqual(parseCSV(''), []);
});

test('empty quoted field', () => {
  assert.deepEqual(parseCSV('"",x'), [['', 'x']]);
});

test('whitespace is preserved', () => {
  assert.deepEqual(parseCSV(' a , b '), [[' a ', ' b ']]);
});

test('custom delimiters', () => {
  assert.deepEqual(parseCSV('a;b;"c;d"', { delimiter: ';' }), [['a', 'b', 'c;d']]);
  assert.deepEqual(parseCSV('a\tb\n1\t2', { delimiter: '\t' }), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('commas are plain text with another delimiter', () => {
  assert.deepEqual(parseCSV('a,b;c', { delimiter: ';' }), [['a,b', 'c']]);
});

test('unterminated quote throws SyntaxError', () => {
  assert.throws(() => parseCSV('a,"oops\n1,2'), SyntaxError);
});

test('single column with blank line in the middle', () => {
  assert.deepEqual(parseCSV('a\n\nb'), [['a'], [''], ['b']]);
});
