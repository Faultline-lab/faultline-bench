'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createWorld(options = {}) {
  const apothem = options.apothem ?? 150;
  const angle = options.angle ?? 0;
  const angularVelocity = options.angularVelocity ?? 1.0;
  const gravity = options.gravity ?? 300;
  const restitution = options.restitution ?? 0.85;
  const friction = options.friction ?? 0.25;
  const substeps = options.substeps ?? 8;
  const seed = options.seed ?? 42;
  const ballRadius = options.ballRadius ?? 12;
  const numBalls = options.numBalls ?? 8;

  let balls;
  if (Array.isArray(options.balls)) {
    balls = options.balls.map((b) => {
      const r = b.r ?? ballRadius;
      return {
        x: b.x,
        y: b.y,
        vx: b.vx ?? 0,
        vy: b.vy ?? 0,
        r,
        mass: b.mass ?? r * r,
      };
    });
  } else {
    const rand = mulberry32(seed);
    balls = [];
    const maxR = apothem * 0.68 - ballRadius;
    for (let i = 0; i < numBalls; i++) {
      for (let attempt = 0; attempt < 500; attempt++) {
        const rad = Math.sqrt(rand()) * maxR;
        const theta = rand() * Math.PI * 2;
        const x = Math.cos(theta) * rad;
        const y = Math.sin(theta) * rad;
        if (balls.every((o) => Math.hypot(x - o.x, y - o.y) >= ballRadius + o.r + 3)) {
          balls.push({
            x,
            y,
            vx: (rand() - 0.5) * 120,
            vy: (rand() - 0.5) * 120,
            r: ballRadius,
            mass: ballRadius * ballRadius,
          });
          break;
        }
      }
    }
  }

  return {
    apothem,
    angle,
    angularVelocity,
    gravity,
    restitution,
    friction,
    substeps,
    time: 0,
    balls,
  };
}

function resolveWallCollisions(world) {
  const { apothem, angle, angularVelocity, restitution, friction, balls } = world;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 6; k++) {
      const theta = angle + (k * Math.PI) / 3;
      const nx = Math.cos(theta);
      const ny = Math.sin(theta);
      const tx = -ny;
      const ty = nx;
      for (const b of balls) {
        const pen = b.x * nx + b.y * ny + b.r - apothem;
        if (pen > 0) {
          b.x -= pen * nx;
          b.y -= pen * ny;
          const cx = b.x + b.r * nx;
          const cy = b.y + b.r * ny;
          const vwx = -angularVelocity * cy;
          const vwy = angularVelocity * cx;
          const rvx = b.vx - vwx;
          const rvy = b.vy - vwy;
          const vn = rvx * nx + rvy * ny;
          if (vn > 0) {
            const jn = -(1 + restitution) * vn;
            b.vx += jn * nx;
            b.vy += jn * ny;
            const vt = rvx * tx + rvy * ty;
            const jtMax = friction * Math.abs(jn);
            const jt = Math.max(-jtMax, Math.min(jtMax, -vt));
            b.vx += jt * tx;
            b.vy += jt * ty;
          }
        }
      }
    }
  }
}

function resolveBallCollisions(world) {
  const { balls, restitution } = world;
  const contacts = [];
  for (let i = 0; i < balls.length; i++) {
    for (let k = i + 1; k < balls.length; k++) {
      const a = balls[i];
      const b = balls[k];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDist = a.r + b.r;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDist * minDist) continue;
      const dist = Math.sqrt(distSq);
      const nx = dist > 1e-9 ? dx / dist : 1;
      const ny = dist > 1e-9 ? dy / dist : 0;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      contacts.push({ a, b, nx, ny, overlap: minDist - dist, vn });
    }
  }

  for (const c of contacts) {
    const { a, b, nx, ny, overlap, vn } = c;
    const invMassA = 1 / a.mass;
    const invMassB = 1 / b.mass;
    const invMassSum = invMassA + invMassB;
    const sep = overlap / invMassSum;
    a.x -= nx * sep * invMassA;
    a.y -= ny * sep * invMassA;
    b.x += nx * sep * invMassB;
    b.y += ny * sep * invMassB;
    if (vn < 0) {
      const j = (-(1 + restitution) * vn) / invMassSum;
      a.vx -= j * nx * invMassA;
      a.vy -= j * ny * invMassA;
      b.vx += j * nx * invMassB;
      b.vy += j * ny * invMassB;
    }
  }
}

function step(world, dt = 1 / 60) {
  if (dt <= 0) return world;
  const substeps = world.substeps || 8;
  const h = dt / substeps;
  for (let s = 0; s < substeps; s++) {
    world.angle += world.angularVelocity * h;
    for (const b of world.balls) {
      b.vy += world.gravity * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    resolveBallCollisions(world);
    resolveWallCollisions(world);
  }
  world.time += dt;
  return world;
}

function snapshot(world) {
  return {
    time: world.time,
    angle: world.angle,
    apothem: world.apothem,
    balls: world.balls.map((b) => ({ ...b })),
  };
}

function run(options = {}, steps = 600) {
  const dt = options.dt ?? 1 / 60;
  const world = createWorld(options);
  const frames = [snapshot(world)];
  for (let i = 0; i < steps; i++) {
    step(world, dt);
    frames.push(snapshot(world));
  }
  return frames;
}

module.exports = { createWorld, step, run };
