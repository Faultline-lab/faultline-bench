'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_GEOM,
  DEFAULT_STATE,
  pistonPosition,
  volume,
  simulateCycle,
  netWorkPerCycle,
} = require('../src/engine');

test('pistonPosition places TDC at r + l and BDC at l - r', () => {
  const tdc = pistonPosition(0, DEFAULT_GEOM);
  const bdc = pistonPosition(Math.PI, DEFAULT_GEOM);
  assert.ok(Math.abs(tdc - (DEFAULT_GEOM.r + DEFAULT_GEOM.l)) < 1e-12);
  assert.ok(Math.abs(bdc - (DEFAULT_GEOM.l - DEFAULT_GEOM.r)) < 1e-12);
});

test('volume increases from TDC to BDC', () => {
  assert.ok(volume(Math.PI, DEFAULT_GEOM) > volume(0, DEFAULT_GEOM));
});

test('cycle produces positive net work', () => {
  const samples = simulateCycle(DEFAULT_GEOM, DEFAULT_STATE, 1);
  const work = netWorkPerCycle(samples);
  assert.ok(work > 0, `expected positive net work, got ${work}`);
});
