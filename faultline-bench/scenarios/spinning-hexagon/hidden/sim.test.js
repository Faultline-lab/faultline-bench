'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, step, run } = require('../src/sim');

function totalEnergy(frame, gravity) {
  let energy = 0;
  for (const b of frame.balls) {
    energy += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
    energy += b.mass * gravity * (frame.apothem - b.y);
  }
  return energy;
}

test('no ball leaves the spinning hexagon over 600 steps', () => {
  const frames = run({ seed: 42, numBalls: 8, angularVelocity: 1.2 }, 600);
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    for (let k = 0; k < 6; k++) {
      const theta = frame.angle + (k * Math.PI) / 3;
      const nx = Math.cos(theta);
      const ny = Math.sin(theta);
      for (let i = 0; i < frame.balls.length; i++) {
        const b = frame.balls[i];
        const signed = b.x * nx + b.y * ny + b.r;
        assert.ok(
          signed <= frame.apothem + 1e-6,
          `frame ${f}, ball ${i}, wall ${k}: signed+r=${signed} > apothem=${frame.apothem}`
        );
      }
    }
  }
});

test('total mechanical energy does not exceed initial value by more than 1% when restitution <= 1', () => {
  for (const restitution of [1, 0.85]) {
    const gravity = 300;
    const frames = run(
      { seed: 7, numBalls: 8, angularVelocity: 0, restitution, friction: 0, gravity },
      600
    );
    const e0 = totalEnergy(frames[0], gravity);
    for (let f = 1; f < frames.length; f++) {
      const e = totalEnergy(frames[f], gravity);
      assert.ok(
        e <= e0 * 1.01,
        `restitution=${restitution}, frame=${f}: energy ${e} exceeded 1.01 * ${e0}`
      );
    }
  }
});

test('ball resting on a tangentially moving wall gains tangential velocity in the wall direction', () => {
  // angle = PI/6 puts wall k=1 horizontal at the bottom (outward normal = (0, 1))
  // With angularVelocity > 0, bottom wall velocity at (0, apothem) is (-angularVelocity * apothem, 0)
  const w = createWorld({
    apothem: 150,
    angle: Math.PI / 6,
    angularVelocity: 1.0,
    gravity: 300,
    restitution: 0,
    friction: 0.5,
    balls: [{ x: 0, y: 138, vx: 0, vy: 0, r: 12, mass: 144 }],
  });
  for (let i = 0; i < 5; i++) step(w, 1 / 60);
  assert.ok(w.balls[0].vx < -1, `expected negative vx matching wall motion, got ${w.balls[0].vx}`);
});

test('two equal balls colliding head-on swap velocities', () => {
  const w = createWorld({
    apothem: 200,
    angle: 0,
    angularVelocity: 0,
    gravity: 0,
    restitution: 1,
    friction: 0,
    balls: [
      { x: -30, y: 0, vx: 80, vy: 0, r: 12, mass: 10 },
      { x: 30, y: 0, vx: -40, vy: 0, r: 12, mass: 10 },
    ],
  });
  for (let i = 0; i < 60; i++) step(w, 1 / 60);
  assert.ok(Math.abs(w.balls[0].vx - -40) < 1e-6, `ball 0 vx=${w.balls[0].vx}`);
  assert.ok(Math.abs(w.balls[1].vx - 80) < 1e-6, `ball 1 vx=${w.balls[1].vx}`);
  assert.ok(Math.abs(w.balls[0].vy) < 1e-6);
  assert.ok(Math.abs(w.balls[1].vy) < 1e-6);
});
