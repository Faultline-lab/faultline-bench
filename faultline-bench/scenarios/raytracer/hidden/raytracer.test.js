'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, shade, intersectSphere, normalAt } = require('../src/trace');
const { reflect, normalize, vec } = require('../src/vec');
const { defaultScene } = require('../src/scene');

const W = 64;
const H = 48;
const image = render(defaultScene(), W, H);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('ray-sphere distance', () => {
  const s = { type: 'sphere', center: vec(0, 0, 0), radius: 1 };
  close(intersectSphere(vec(0, 0, 5), vec(0, 0, -1), s), 4);
  assert.equal(intersectSphere(vec(0, 3, 5), vec(0, 0, -1), s), Infinity);
});

test('sphere normals are unit length and point outward', () => {
  const s = { type: 'sphere', center: vec(1, 2, 3), radius: 2.5 };
  const n = normalAt(s, vec(1, 4.5, 3));
  close(Math.hypot(n.x, n.y, n.z), 1, 1e-9);
  assert.ok(n.y > 0.99);
});

test('mirror reflection keeps the tangent part and flips the normal part', () => {
  const r = reflect(normalize(vec(1, -1, 0)), vec(0, 1, 0));
  close(r.x, Math.SQRT1_2, 1e-9);
  close(r.y, Math.SQRT1_2, 1e-9);
  close(r.z, 0, 1e-9);
});

test('the lit side of a sphere is fully lit, with no dark speckles', () => {
  const scene = defaultScene();
  const red = scene.objects[1];
  const towardLight = normalize(vec(-1, 1, 1));
  let dark = 0;
  let total = 0;
  for (let a = -0.4; a <= 0.4; a += 0.05) {
    for (let b = -0.4; b <= 0.4; b += 0.05) {
      const n = normalize(vec(towardLight.x + a, towardLight.y + b, towardLight.z));
      const target = vec(red.center.x + red.radius * n.x, red.center.y + red.radius * n.y, red.center.z + red.radius * n.z);
      const dir = normalize(vec(target.x - scene.camera.origin.x, target.y - scene.camera.origin.y, target.z - scene.camera.origin.z));
      const c = shade(scene, scene.camera.origin, dir);
      total++;
      if (c.x < 0.35) dark++;
    }
  }
  assert.ok(dark / total < 0.02, `${dark} of ${total} lit samples are dark (shadow acne)`);
});

test('floor next to the red ball is in shadow, open floor is lit', () => {
  const scene = defaultScene();
  const lit = shade(scene, vec(-3, 2, 3), normalize(vec(0, -1, -0.2)));
  const shaded = shade(scene, vec(-0.2, 2, 0), normalize(vec(0, -1, 0)));
  assert.ok(lit.x > shaded.x + 0.2, `lit floor ${lit.x.toFixed(3)} should be brighter than shadowed floor ${shaded.x.toFixed(3)}`);
});

test('the mirror ball reflects the red ball on its left side', () => {
  // Rendered larger than the main image so the small reflection covers enough pixels.
  const w = 160;
  const h = 120;
  const big = render(defaultScene(), w, h);
  let reddest = { r: -Infinity };
  for (let j = 0; j < h; j++) {
    for (let i = 75; i < 135; i++) {
      const k = (j * w + i) * 3;
      const r = big.pixels[k] - (big.pixels[k + 1] + big.pixels[k + 2]) / 2;
      if (r > reddest.r) reddest = { r, i, j };
    }
  }
  assert.ok(reddest.r > 40, `no red reflection found in the mirror ball (best ${reddest.r.toFixed(1)})`);
  assert.ok(reddest.i < 105, `red reflection at x=${reddest.i} should be on the left half of the mirror ball`);
});

test('overall brightness matches the reference image', () => {
  let sum = 0;
  for (const v of image.pixels) sum += v;
  const mean = sum / image.pixels.length / 255;
  assert.ok(Math.abs(mean - 0.701) < 0.035, `mean brightness ${mean.toFixed(3)} should be about 0.701`);
});
