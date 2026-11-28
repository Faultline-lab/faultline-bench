'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, step, run } = require('../src/sim');

test('createWorld initializes balls deterministically', () => {
  const a = createWorld({ seed: 123, numBalls: 5 });
  const b = createWorld({ seed: 123, numBalls: 5 });
  assert.equal(a.balls.length, 5);
  assert.deepEqual(a.balls, b.balls);
});

test('step advances hexagon angle and run returns expected frame count', () => {
  const w = createWorld({ angularVelocity: 2, numBalls: 1 });
  step(w, 0.5);
  assert.ok(Math.abs(w.angle - 1) < 1e-9);
  const frames = run({ numBalls: 2 }, 10);
  assert.equal(frames.length, 11);
});
