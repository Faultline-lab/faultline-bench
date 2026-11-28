'use strict';

const { vec, normalize } = require('./vec');

// Colors are linear RGB in 0..1. reflectivity is 0 (matte) to 1 (perfect mirror).
const sphere = (center, radius, color, reflectivity = 0) => ({ type: 'sphere', center, radius, color, reflectivity });
const plane = (point, normal, color) => ({ type: 'plane', point, normal: normalize(normal), color, reflectivity: 0 });

// A red ball on the left, a large mirror ball on the right, a small blue ball in front,
// all resting on a grey floor and lit by one point light high up on the left.
function defaultScene() {
  return {
    camera: { origin: vec(0, 1.4, 5), lookAt: vec(0, 0.7, 0), fov: 45 },
    light: { position: vec(-5, 5, 1), intensity: 1 },
    ambient: 0.1,
    background: vec(0.55, 0.7, 0.9),
    objects: [
      plane(vec(0, 0, 0), vec(0, 1, 0), vec(0.75, 0.75, 0.7)),
      sphere(vec(-1.1, 0.7, 0), 0.7, vec(0.9, 0.15, 0.1)),
      sphere(vec(0.9, 0.9, -0.4), 0.9, vec(0.85, 0.85, 0.9), 0.8),
      sphere(vec(0.2, 0.35, 1.3), 0.35, vec(0.15, 0.3, 0.9)),
    ],
  };
}

module.exports = { sphere, plane, defaultScene };
