'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/trace');
const { defaultScene } = require('../src/scene');

test('render returns one rgb byte triple per pixel', () => {
  const img = render(defaultScene(), 8, 6);
  assert.equal(img.width, 8);
  assert.equal(img.height, 6);
  assert.equal(img.pixels.length, 8 * 6 * 3);
});
