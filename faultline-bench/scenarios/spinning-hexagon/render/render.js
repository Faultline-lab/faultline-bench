'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PALETTE = ['#38bdf8', '#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#2dd4bf'];
const ESCAPED_COLOR = '#ef4444';

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clampCoord(v, fallback = 0) {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(-240, Math.min(240, v));
}

function fmt(n) {
  return clampCoord(n).toFixed(1);
}

function isBallEscaped(b, angle, apothem) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.r)) return true;
  for (let k = 0; k < 6; k++) {
    const theta = angle + (k * Math.PI) / 3;
    const signed = b.x * Math.cos(theta) + b.y * Math.sin(theta) + b.r;
    if (signed > apothem + 1e-3) return true;
  }
  return false;
}

function frameEnergy(frame, gravity) {
  let energy = 0;
  for (const b of frame.balls) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
      return Infinity;
    }
    const mass = Number.isFinite(b.mass) ? b.mass : (b.r || 12) * (b.r || 12);
    energy += 0.5 * mass * (b.vx * b.vx + b.vy * b.vy);
    energy += mass * gravity * (frame.apothem - b.y);
  }
  return energy;
}

function formatDrift(pct) {
  if (!Number.isFinite(pct)) return '+Infinity%';
  const sign = pct > 0.05 ? '+' : '';
  if (Math.abs(pct) >= 10000) return `${sign}${pct.toExponential(1)}%`;
  return `${sign}${pct.toFixed(1)}%`;
}

function hexPoints(apothem) {
  const r = (2 * apothem) / Math.sqrt(3);
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) * Math.PI) / 3;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function renderFallback(message) {
  const safeMsg = escapeXml(String(message || 'unknown error').slice(0, 140));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-260 -260 520 560" width="520" height="560">',
    '  <rect x="-260" y="-260" width="520" height="560" fill="#0f172a"/>',
    `  <polygon points="${hexPoints(150)}" fill="none" stroke="#475569" stroke-width="3" stroke-dasharray="8 6"/>`,
    '  <text x="0" y="-10" text-anchor="middle" fill="#ef4444" font-family="monospace" font-size="18" font-weight="bold">Spinning Hexagon</text>',
    `  <text x="0" y="20" text-anchor="middle" fill="#fca5a5" font-family="monospace" font-size="13">render failed: ${safeMsg}</text>`,
    '  <text x="0" y="268" text-anchor="middle" fill="#ef4444" font-family="monospace" font-size="14">escaped: error | energy drift: N/A</text>',
    '</svg>',
    '',
  ].join('\n');
}

function buildSvg(sim) {
  const opts = {
    seed: 42,
    numBalls: 8,
    apothem: 150,
    angularVelocity: 1.0,
    gravity: 300,
    restitution: 0.85,
    friction: 0.25,
  };
  const totalSteps = 480;
  const frames = sim.run(opts, totalSteps);
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error('run() did not return simulation frames');
  }

  const sampled = [];
  for (let i = 0; i < frames.length && sampled.length < 240; i += 2) {
    sampled.push(frames[i]);
  }
  if (sampled.length < 2) sampled.push(frames[frames.length - 1]);

  const e0 = frameEnergy(frames[0], opts.gravity);
  let maxEnergy = e0;
  const escapedEver = new Set();

  for (const frame of frames) {
    const e = frameEnergy(frame, opts.gravity);
    if (e > maxEnergy) maxEnergy = e;
    const balls = Array.isArray(frame.balls) ? frame.balls : [];
    for (let i = 0; i < balls.length; i++) {
      if (isBallEscaped(balls[i], frame.angle, frame.apothem || opts.apothem)) {
        escapedEver.add(i);
      }
    }
  }

  const driftPct = e0 > 0 ? ((maxEnergy - e0) / e0) * 100 : 0;
  const escapedCount = escapedEver.size;
  const apothem = sampled[0].apothem || opts.apothem;
  const numBalls = Array.isArray(sampled[0].balls) ? sampled[0].balls.length : 0;
  const dur = '8s';
  const angles = sampled.map((f) => ((Number.isFinite(f.angle) ? f.angle : 0) * 180 / Math.PI).toFixed(1)).join(';');

  const lines = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-260 -260 520 560" width="520" height="560">',
    '  <rect x="-260" y="-260" width="520" height="560" fill="#0f172a"/>',
    '  <g>',
    `    <polygon points="${hexPoints(apothem)}" fill="#1e293b" fill-opacity="0.45" stroke="#94a3b8" stroke-width="3" stroke-linejoin="round"/>`,
    `    <animateTransform attributeName="transform" type="rotate" values="${angles}" dur="${dur}" repeatCount="indefinite"/>`,
    '  </g>',
  ];

  // Draw trails first so balls sit on top
  for (let i = 0; i < numBalls; i++) {
    const baseColor = PALETTE[i % PALETTE.length];
    const trailColor = escapedEver.has(i) ? ESCAPED_COLOR : baseColor;
    const pts = sampled
      .map((f) => {
        const b = f.balls[i] || { x: 0, y: 0 };
        return `${fmt(b.x)},${fmt(b.y)}`;
      })
      .join(' ');
    lines.push(
      `  <polyline points="${pts}" fill="none" stroke="${trailColor}" stroke-width="1.5" stroke-opacity="0.28" stroke-linecap="round"/>`
    );
  }

  // Draw trailing ghost dots + balls
  for (let i = 0; i < numBalls; i++) {
    const baseColor = PALETTE[i % PALETTE.length];
    const r0 = Number.isFinite(sampled[0].balls[i]?.r) ? sampled[0].balls[i].r : 12;
    const cxVals = [];
    const cyVals = [];
    const fillVals = [];
    let anyEscaped = false;
    for (const f of sampled) {
      const b = f.balls[i] || { x: 0, y: 0, r: r0 };
      const esc = isBallEscaped(b, f.angle, f.apothem || apothem);
      if (esc) anyEscaped = true;
      cxVals.push(fmt(b.x));
      cyVals.push(fmt(b.y));
      fillVals.push(esc ? ESCAPED_COLOR : baseColor);
    }

    for (const lag of [4, 2]) {
      const lagCx = sampled.map((_, idx) => cxVals[Math.max(0, idx - lag)]).join(';');
      const lagCy = sampled.map((_, idx) => cyVals[Math.max(0, idx - lag)]).join(';');
      const ghostR = (r0 * (lag === 4 ? 0.45 : 0.68)).toFixed(1);
      const ghostOp = lag === 4 ? '0.18' : '0.32';
      const ghostFill = anyEscaped ? ESCAPED_COLOR : baseColor;
      lines.push(
        `  <circle cx="${cxVals[0]}" cy="${cyVals[0]}" r="${ghostR}" fill="${ghostFill}" fill-opacity="${ghostOp}">`,
        `    <animate attributeName="cx" values="${lagCx}" dur="${dur}" repeatCount="indefinite"/>`,
        `    <animate attributeName="cy" values="${lagCy}" dur="${dur}" repeatCount="indefinite"/>`,
        '  </circle>'
      );
    }

    const staticFill = anyEscaped ? ESCAPED_COLOR : baseColor;
    lines.push(
      `  <circle cx="${cxVals[0]}" cy="${cyVals[0]}" r="${r0.toFixed(1)}" fill="${staticFill}" stroke="#f8fafc" stroke-width="1">`
    );
    lines.push(`    <animate attributeName="cx" values="${cxVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>`);
    lines.push(`    <animate attributeName="cy" values="${cyVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>`);
    if (anyEscaped) {
      lines.push(`    <animate attributeName="fill" values="${fillVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>`);
    }
    lines.push('  </circle>');
  }

  const healthy = escapedCount === 0 && driftPct <= 1;
  const statusColor = healthy ? '#4ade80' : '#f87171';
  const caption = `escaped: ${escapedCount} | energy drift: ${formatDrift(driftPct)}`;

  lines.push(
    '  <rect x="-260" y="226" width="520" height="74" fill="#020617" fill-opacity="0.88"/>',
    '  <text x="0" y="252" text-anchor="middle" fill="#e2e8f0" font-family="ui-monospace, monospace" font-size="16" font-weight="bold">Spinning Hexagon</text>',
    `  <text x="0" y="278" text-anchor="middle" fill="${statusColor}" font-family="ui-monospace, monospace" font-size="14">${escapeXml(caption)}</text>`,
    '</svg>',
    ''
  );

  return lines.join('\n');
}

function main() {
  const [, , workspaceDir, outFile] = process.argv;
  if (!workspaceDir || !outFile) {
    process.stderr.write('Usage: node render.js <workspaceDir> <outFile>\n');
    process.exit(1);
  }

  let svg;
  try {
    const simPath = path.resolve(workspaceDir, 'src', 'sim.js');
    const sim = require(simPath);
    if (!sim || typeof sim.run !== 'function') {
      throw new Error('src/sim.js must export run(options, steps)');
    }
    svg = buildSvg(sim);
  } catch (err) {
    svg = renderFallback(err && err.message ? err.message : String(err));
  }

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, svg, 'utf8');
}

main();
