'use strict';

// Small immutable 3D vector helpers. Vectors are plain { x, y, z } objects.

const vec = (x, y, z) => ({ x, y, z });
const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => vec(a.x * s, a.y * s, a.z * s);
const mul = (a, b) => vec(a.x * b.x, a.y * b.y, a.z * b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => scale(a, 1 / length(a));

// Mirror direction d about the unit surface normal n.
const reflect = (d, n) => sub(d, scale(n, 2 * dot(d, n)));

module.exports = { vec, add, sub, scale, mul, dot, cross, length, normalize, reflect };
