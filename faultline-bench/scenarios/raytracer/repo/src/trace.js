'use strict';

const { vec, add, sub, scale, dot, cross, length, normalize, reflect } = require('./vec');

const GAMMA = 2.2;
const BIAS = 1e-4; // nudge secondary rays off the surface they start on
const MAX_DEPTH = 1; // one bounce of mirror reflection

// Distance along the unit ray (origin, dir) to the sphere, or Infinity on a miss.
function intersectSphere(origin, dir, s) {
  const oc = sub(origin, s.center);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - s.radius * s.radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const t1 = -b - root;
  if (t1 > 0) return t1;
  const t2 = -b + root;
  return t2 > 0 ? t2 : Infinity;
}

// Distance along the unit ray to the plane, or Infinity on a miss.
function intersectPlane(origin, dir, p) {
  const denom = dot(dir, p.normal);
  if (Math.abs(denom) < 1e-12) return Infinity;
  const t = dot(sub(p.point, origin), p.normal) / denom;
  return t > 0 ? t : Infinity;
}

function intersect(origin, dir, obj) {
  return obj.type === 'sphere' ? intersectSphere(origin, dir, obj) : intersectPlane(origin, dir, obj);
}

// Outward unit surface normal of obj at point p.
function normalAt(obj, p) {
  return obj.type === 'sphere' ? sub(p, obj.center) : obj.normal;
}

function nearest(scene, origin, dir) {
  let hit = { t: Infinity, obj: null };
  for (const obj of scene.objects) {
    const t = intersect(origin, dir, obj);
    if (t < hit.t) hit = { t, obj };
  }
  return hit;
}

function inShadow(scene, p, n) {
  const toLight = sub(scene.light.position, p);
  const dist = length(toLight);
  return nearest(scene, p, scale(toLight, 1 / dist)).t < dist;
}

// Linear RGB color seen along the unit ray (origin, dir).
function shade(scene, origin, dir, depth = 0) {
  const { t, obj } = nearest(scene, origin, dir);
  if (!obj) return scene.background;
  const p = add(origin, scale(dir, t));
  const n = normalAt(obj, p);
  const l = normalize(sub(scene.light.position, p));
  const diffuse = inShadow(scene, p, n) ? 0 : Math.max(0, dot(n, l)) * scene.light.intensity;
  let color = scale(obj.color, scene.ambient + diffuse);
  if (obj.reflectivity > 0 && depth < MAX_DEPTH) {
    const bounced = shade(scene, add(p, scale(n, BIAS)), reflect(dir, n), depth + 1);
    color = add(scale(color, 1 - obj.reflectivity), scale(bounced, obj.reflectivity));
  }
  return color;
}

const clamp = (v) => Math.min(1, Math.max(0, v));
const toSRGB = (c) => vec(clamp(c.x) ** (1 / GAMMA), clamp(c.y) ** (1 / GAMMA), clamp(c.z) ** (1 / GAMMA));
const toByte = (v) => Math.round(255 * clamp(v) ** (1 / GAMMA));

// Unit ray direction through the centre of pixel (i, j); j = 0 is the top row.
function primaryRay(camera, width, height, i, j) {
  const forward = normalize(sub(camera.lookAt, camera.origin));
  const right = normalize(cross(forward, vec(0, 1, 0)));
  const up = cross(right, forward);
  const h = Math.tan((camera.fov * Math.PI) / 360);
  const u = ((2 * (i + 0.5)) / width - 1) * h * (width / height);
  const v = (1 - (2 * (j + 0.5)) / height) * h;
  return normalize(add(forward, add(scale(right, u), scale(up, v))));
}

// Renders the scene to 8-bit sRGB: { width, height, pixels: Uint8Array of r,g,b per pixel, row by row }.
function render(scene, width, height) {
  const pixels = new Uint8Array(width * height * 3);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const c = toSRGB(shade(scene, scene.camera.origin, primaryRay(scene.camera, width, height, i, j)));
      const k = (j * width + i) * 3;
      pixels[k] = toByte(c.x);
      pixels[k + 1] = toByte(c.y);
      pixels[k + 2] = toByte(c.z);
    }
  }
  return { width, height, pixels };
}

module.exports = { render, shade, intersectSphere, intersectPlane, normalAt, primaryRay };
