'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GEOM = {
  r: 0.045,
  l: 0.15,
  bore: 0.086,
  compressionRatio: 10,
};

const STATE = {
  pIntake: 101325,
  pExhaust: 101325,
  pAtm: 101325,
  gamma: 1.4,
  qIn: 800,
};

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : 'NaN';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function writeOut(outFile, svg) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, svg, 'utf8');
}

function renderErrorSvg(message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 520" width="1100" height="520">
  <rect width="1100" height="520" fill="#0f172a"/>
  <rect x="24" y="24" width="1052" height="472" rx="12" fill="#1e293b" stroke="#ef4444" stroke-width="2"/>
  <text x="56" y="88" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700">engine-sim · Four-Stroke Otto Engine</text>
  <rect x="56" y="116" width="160" height="28" rx="6" fill="#7f1d1d" stroke="#ef4444"/>
  <text x="136" y="135" text-anchor="middle" fill="#fecaca" font-family="ui-monospace, monospace" font-size="13" font-weight="700">RENDER FAILED</text>
  <text x="56" y="190" fill="#fca5a5" font-family="ui-monospace, monospace" font-size="16">render failed: ${esc(message)}</text>
</svg>
`;
}

function pressureColor(p, pIntake) {
  const ratio = p / Math.max(1, pIntake);
  if (ratio > 12) return '#f97316';
  if (ratio > 3) return '#eab308';
  if (ratio > 1.05) return '#fbbf24';
  return '#38bdf8';
}

function buildSvg(samples1, netWork) {
  const area = Math.PI * (GEOM.bore / 2) ** 2;
  const disp = area * 2 * GEOM.r;
  const vc = disp / (GEOM.compressionRatio - 1);
  const vMax = vc + disp;
  const etaOtto = 1 - Math.pow(GEOM.compressionRatio, 1 - STATE.gamma);
  const analyticWork = STATE.qIn * etaOtto + (STATE.pIntake - STATE.pExhaust) * disp;

  let peak = samples1[0];
  let sumTorque = 0;
  let maxJump = 0;
  for (let i = 0; i < samples1.length; i++) {
    const s = samples1[i];
    if (s.p > peak.p) peak = s;
    sumTorque += s.torque;
    const prev = samples1[(i - 1 + samples1.length) % samples1.length];
    const jump = Math.abs(s.x - prev.x);
    if (jump > maxJump) maxJump = jump;
  }
  const meanTorque = sumTorque / samples1.length;

  const maxStepDx = GEOM.r * (1 + GEOM.r / GEOM.l) * ((2 * Math.PI) / 360) * 1.8;
  const pistonJumping = maxJump > maxStepDx;
  const wrongStrokeOrder = peak.thetaDeg < 355 || peak.thetaDeg > 385;
  const badWork = !(netWork > 0) || Math.abs(netWork - analyticWork) / analyticWork > 0.05;
  const badTorque = !(meanTorque > 0);
  const hasFault = pistonJumping || wrongStrokeOrder || badWork || badTorque;

  const faults = [];
  if (pistonJumping) faults.push('PISTON JUMPING');
  if (wrongStrokeOrder) faults.push(`PEAK @ ${Math.round(peak.thetaDeg)}°`);
  if (badWork) faults.push('WORK MISMATCH');
  if (badTorque) faults.push('INVERTED TORQUE');

  // Downsample to 2-deg steps for smooth charts under 400 KB
  const samples = samples1.filter((_, idx) => idx % 2 === 0);

  // Keyframes every 10 deg (73 points: 0..720) for SMIL animation
  const animFrames = [];
  for (let deg = 0; deg <= 720; deg += 10) {
    const idx = deg === 720 ? 0 : Math.min(samples1.length - 1, Math.round(deg * (samples1.length / 720)));
    animFrames.push({ deg, sample: samples1[idx] });
  }

  // Panel 1: Animated Cylinder, Piston, Rod & Crank
  const cx = 180;
  const cy = 405;
  const R = 38;
  const L = 126;
  const pxPerM = R / GEOM.r;
  const headY = 200;
  const tdcPinY = cy - (R + L); // 241
  const crownOffset = 24;

  const pinXVals = [];
  const pinYVals = [];
  const wristYVals = [];
  const crownYVals = [];
  const chamberHVals = [];
  const chamberColorVals = [];
  const chamberOpacityVals = [];

  for (const { deg, sample } of animFrames) {
    const rad = (deg * Math.PI) / 180;
    const px = cx + R * Math.sin(rad);
    const py = cy - R * Math.cos(rad);
    const wy = clamp(cy - sample.x * pxPerM, headY + crownOffset + 4, cy - 20);
    const crownY = wy - crownOffset;
    const chH = Math.max(4, crownY - headY);
    pinXVals.push(px.toFixed(1));
    pinYVals.push(py.toFixed(1));
    wristYVals.push(wy.toFixed(1));
    crownYVals.push(crownY.toFixed(1));
    chamberHVals.push(chH.toFixed(1));
    chamberColorVals.push(pressureColor(sample.p, STATE.pIntake));
    const op = clamp(0.18 + 0.72 * Math.min(1, sample.p / (40 * STATE.pIntake)), 0.18, 0.9);
    chamberOpacityVals.push(op.toFixed(2));
  }

  const dur = '6s';

  // Panel 2: P-V Diagram
  const pvX0 = 422;
  const pvX1 = 690;
  const pvY0 = 126;
  const pvY1 = 444;
  let vMinPlot = vc * 0.85;
  let vMaxPlot = vMax * 1.05;
  let pMaxPlot = Math.max(90e5, peak.p * 1.08);
  for (const s of samples) {
    if (s.V < vMinPlot) vMinPlot = s.V;
    if (s.V > vMaxPlot) vMaxPlot = s.V;
    if (s.p > pMaxPlot) pMaxPlot = s.p * 1.05;
  }
  const mapPvX = (v) => pvX0 + ((v - vMinPlot) / Math.max(1e-9, vMaxPlot - vMinPlot)) * (pvX1 - pvX0);
  const mapPvY = (p) => pvY1 - (p / Math.max(1, pMaxPlot)) * (pvY1 - pvY0);
  const pvPoints = samples.map((s) => `${mapPvX(s.V).toFixed(1)},${mapPvY(s.p).toFixed(1)}`).join(' ');
  const pvStroke = pistonJumping || badWork ? '#f43f5e' : '#22d3ee';
  const pvFill = pistonJumping || badWork ? 'rgba(244,63,94,0.16)' : 'rgba(34,211,238,0.16)';

  // Panel 3: Torque vs Crank Angle
  const tqX0 = 788;
  const tqX1 = 1062;
  const tqY0 = 126;
  const tqY1 = 444;
  let tMaxAbs = 100;
  for (const s of samples) {
    const a = Math.abs(s.torque);
    if (a > tMaxAbs) tMaxAbs = a;
  }
  tMaxAbs *= 1.12;
  const mapTqX = (deg) => tqX0 + (deg / 720) * (tqX1 - tqX0);
  const mapTqY = (t) => tqY0 + ((tMaxAbs - t) / (2 * tMaxAbs)) * (tqY1 - tqY0);
  const tqZeroY = mapTqY(0);
  const meanTqY = mapTqY(meanTorque);
  const tqPoints = samples.map((s) => `${mapTqX(s.thetaDeg).toFixed(1)},${mapTqY(s.torque).toFixed(1)}`).join(' ');
  const tqAreaPoints = `${tqX0.toFixed(1)},${tqZeroY.toFixed(1)} ${tqPoints} ${mapTqX(samples[samples.length - 1].thetaDeg).toFixed(1)},${tqZeroY.toFixed(1)}`;
  const tqColor = badTorque || wrongStrokeOrder ? '#f43f5e' : '#34d399';
  const tqFill = badTorque || wrongStrokeOrder ? 'rgba(244,63,94,0.18)' : 'rgba(52,211,153,0.18)';

  const badgeBg = hasFault ? '#7f1d1d' : '#064e3b';
  const badgeStroke = hasFault ? '#ef4444' : '#10b981';
  const badgeText = hasFault ? '#fecaca' : '#a7f3d0';
  const badgeLabel = hasFault ? `FAULT: ${faults.join(' · ')}` : 'NOMINAL CYCLE';

  const peakBar = peak.p / 1e5;
  const caption = `engine-sim · Net work: ${fmt(netWork, 1)} J/cycle · Mean torque: ${fmt(meanTorque, 1)} N·m · Peak pressure: ${fmt(peakBar, 1)} bar @ ${Math.round(peak.thetaDeg)}°`;

  const pvGridY = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const pVal = (pMaxPlot / 1e5) * f;
      const y = pvY1 - f * (pvY1 - pvY0);
      return `<line x1="${pvX0}" y1="${y.toFixed(1)}" x2="${pvX1}" y2="${y.toFixed(1)}" stroke="#334155" stroke-dasharray="3,3"/>
      <text x="${pvX0 - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="10">${Math.round(pVal)}</text>`;
    })
    .join('\n');

  const tqGridX = [0, 180, 360, 540, 720]
    .map((deg) => {
      const x = mapTqX(deg);
      return `<line x1="${x.toFixed(1)}" y1="${tqY0}" x2="${x.toFixed(1)}" y2="${tqY1}" stroke="${deg === 360 ? '#f59e0b' : '#334155'}" stroke-dasharray="${deg === 360 ? '4,3' : '3,3'}" stroke-opacity="${deg === 360 ? '0.8' : '1'}"/>
      <text x="${x.toFixed(1)}" y="${tqY1 + 16}" text-anchor="middle" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="10">${deg}°</text>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 520" width="1100" height="520">
  <rect width="1100" height="520" fill="#0f172a"/>

  <!-- Header & Caption -->
  <text x="24" y="34" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700">Four-Stroke Otto Engine Simulator</text>
  <text x="24" y="56" fill="#cbd5e1" font-family="ui-monospace, monospace" font-size="12.5">${esc(caption)}</text>
  <rect x="690" y="18" width="386" height="30" rx="6" fill="${badgeBg}" stroke="${badgeStroke}" stroke-width="1.5"/>
  <text x="883" y="38" text-anchor="middle" fill="${badgeText}" font-family="ui-monospace, monospace" font-size="12" font-weight="700">${esc(badgeLabel)}</text>

  <!-- Panel 1: Animated Cylinder & Crank -->
  <rect x="20" y="76" width="320" height="424" rx="10" fill="#1e293b" stroke="#334155"/>
  <text x="36" y="102" fill="#e2e8f0" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600">Kinematics &amp; Combustion (SMIL)</text>
  <text x="36" y="120" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">Bore 86 mm · Stroke 90 mm · CR 10:1</text>

  <!-- Crankcase & Cylinder -->
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#475569" stroke-width="2" stroke-dasharray="4,4"/>
  <circle cx="${cx}" cy="${cy}" r="5" fill="#94a3b8"/>
  <line x1="${cx - 46}" y1="${headY}" x2="${cx - 46}" y2="352" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
  <line x1="${cx + 46}" y1="${headY}" x2="${cx + 46}" y2="352" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
  <line x1="${cx - 48}" y1="${headY}" x2="${cx + 48}" y2="${headY}" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/>
  <!-- Spark plug -->
  <rect x="${cx - 4}" y="${headY - 14}" width="8" height="14" fill="#e2e8f0"/>
  <line x1="${cx}" y1="${headY}" x2="${cx}" y2="${headY + 5}" stroke="#f59e0b" stroke-width="2"/>
  <!-- TDC / BDC reference ticks -->
  <line x1="${cx + 50}" y1="${tdcPinY - crownOffset}" x2="${cx + 62}" y2="${tdcPinY - crownOffset}" stroke="#64748b" stroke-width="1"/>
  <text x="${cx + 65}" y="${tdcPinY - crownOffset + 3}" fill="#64748b" font-family="ui-monospace, monospace" font-size="9">TDC</text>
  <line x1="${cx + 50}" y1="${cy - (L - R) - crownOffset}" x2="${cx + 62}" y2="${cy - (L - R) - crownOffset}" stroke="#64748b" stroke-width="1"/>
  <text x="${cx + 65}" y="${cy - (L - R) - crownOffset + 3}" fill="#64748b" font-family="ui-monospace, monospace" font-size="9">BDC</text>

  <!-- Combustion Chamber Gas -->
  <rect x="${cx - 43}" y="${headY + 2}" width="86" height="${chamberHVals[0]}" fill="${chamberColorVals[0]}" fill-opacity="${chamberOpacityVals[0]}">
    <animate attributeName="height" values="${chamberHVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
    <animate attributeName="fill" values="${chamberColorVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
    <animate attributeName="fill-opacity" values="${chamberOpacityVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
  </rect>

  <!-- Piston Body -->
  <rect x="${cx - 42}" y="${crownYVals[0]}" width="84" height="44" rx="4" fill="#64748b" stroke="#cbd5e1" stroke-width="1.5">
    <animate attributeName="y" values="${crownYVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
  </rect>

  <!-- Connecting Rod -->
  <line x1="${cx}" y1="${wristYVals[0]}" x2="${pinXVals[0]}" y2="${pinYVals[0]}" stroke="#e2e8f0" stroke-width="6" stroke-linecap="round">
    <animate attributeName="y1" values="${wristYVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
    <animate attributeName="x2" values="${pinXVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
    <animate attributeName="y2" values="${pinYVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
  </line>

  <!-- Crank Arm -->
  <line x1="${cx}" y1="${cy}" x2="${pinXVals[0]}" y2="${pinYVals[0]}" stroke="#38bdf8" stroke-width="6" stroke-linecap="round">
    <animate attributeName="x2" values="${pinXVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
    <animate attributeName="y2" values="${pinYVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
  </line>

  <!-- Wrist Pin & Crank Pin -->
  <circle cx="${cx}" cy="${wristYVals[0]}" r="5" fill="#0f172a" stroke="#f8fafc" stroke-width="2">
    <animate attributeName="cy" values="${wristYVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
  </circle>
  <circle cx="${pinXVals[0]}" cy="${pinYVals[0]}" r="6" fill="#0f172a" stroke="#38bdf8" stroke-width="2">
    <animate attributeName="cx" values="${pinXVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
    <animate attributeName="cy" values="${pinYVals.join(';')}" dur="${dur}" repeatCount="indefinite"/>
  </circle>
  <text x="${cx}" y="476" text-anchor="middle" fill="${pistonJumping ? '#fda4af' : '#94a3b8'}" font-family="ui-monospace, monospace" font-size="11">${pistonJumping ? 'Warning: non-smooth piston motion' : 'Smooth 720° slider-crank cycle'}</text>

  <!-- Panel 2: P-V Diagram -->
  <rect x="356" y="76" width="356" height="424" rx="10" fill="#1e293b" stroke="#334155"/>
  <text x="372" y="102" fill="#e2e8f0" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600">Pressure–Volume (P–V) Diagram</text>
  <text x="372" y="120" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">Net work: ${fmt(netWork, 1)} J (Otto ref: ${fmt(analyticWork, 1)} J)</text>
  ${pvGridY}
  <line x1="${pvX0}" y1="${pvY0}" x2="${pvX0}" y2="${pvY1}" stroke="#64748b"/>
  <line x1="${pvX0}" y1="${pvY1}" x2="${pvX1}" y2="${pvY1}" stroke="#64748b"/>
  <polygon points="${pvPoints}" fill="${pvFill}"/>
  <polyline points="${pvPoints}" fill="none" stroke="${pvStroke}" stroke-width="2.2" stroke-linejoin="round"/>
  <circle cx="${mapPvX(peak.V).toFixed(1)}" cy="${mapPvY(peak.p).toFixed(1)}" r="4.5" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/>
  <text x="${Math.min(pvX1 - 65, mapPvX(peak.V) + 8).toFixed(1)}" y="${Math.max(pvY0 + 14, mapPvY(peak.p) - 6).toFixed(1)}" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="10.5">${fmt(peakBar, 1)} bar</text>
  <text x="${(pvX0 + pvX1) / 2}" y="476" text-anchor="middle" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">Volume (cm³): ${fmt(vc * 1e6, 0)}–${fmt(vMax * 1e6, 0)} cm³</text>
  <text x="374" y="${(pvY0 + pvY1) / 2}" text-anchor="middle" transform="rotate(-90 374 ${(pvY0 + pvY1) / 2})" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">Pressure (bar)</text>

  <!-- Panel 3: Torque vs Crank Angle -->
  <rect x="728" y="76" width="352" height="424" rx="10" fill="#1e293b" stroke="#334155"/>
  <text x="744" y="102" fill="#e2e8f0" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600">Crank Torque vs Crank Angle</text>
  <text x="744" y="120" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">Mean torque: ${fmt(meanTorque, 1)} N·m</text>
  ${tqGridX}
  <line x1="${tqX0}" y1="${tqY0}" x2="${tqX0}" y2="${tqY1}" stroke="#64748b"/>
  <line x1="${tqX0}" y1="${tqZeroY.toFixed(1)}" x2="${tqX1}" y2="${tqZeroY.toFixed(1)}" stroke="#94a3b8" stroke-width="1.2"/>
  <text x="${tqX0 - 6}" y="${(tqZeroY + 4).toFixed(1)}" text-anchor="end" fill="#cbd5e1" font-family="ui-monospace, monospace" font-size="10">0</text>
  <text x="${tqX0 - 6}" y="${tqY0 + 10}" text-anchor="end" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="10">+${Math.round(tMaxAbs)}</text>
  <text x="${tqX0 - 6}" y="${tqY1}" text-anchor="end" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="10">-${Math.round(tMaxAbs)}</text>
  <line x1="${tqX0}" y1="${meanTqY.toFixed(1)}" x2="${tqX1}" y2="${meanTqY.toFixed(1)}" stroke="#fbbf24" stroke-width="1.3" stroke-dasharray="5,4"/>
  <polygon points="${tqAreaPoints}" fill="${tqFill}"/>
  <polyline points="${tqPoints}" fill="none" stroke="${tqColor}" stroke-width="2.2" stroke-linejoin="round"/>
  <text x="${mapTqX(90).toFixed(1)}" y="${tqY0 + 14}" text-anchor="middle" fill="#64748b" font-family="ui-monospace, monospace" font-size="9.5">Intake</text>
  <text x="${mapTqX(270).toFixed(1)}" y="${tqY0 + 14}" text-anchor="middle" fill="#64748b" font-family="ui-monospace, monospace" font-size="9.5">Comp</text>
  <text x="${mapTqX(450).toFixed(1)}" y="${tqY0 + 14}" text-anchor="middle" fill="#64748b" font-family="ui-monospace, monospace" font-size="9.5">Power</text>
  <text x="${mapTqX(630).toFixed(1)}" y="${tqY0 + 14}" text-anchor="middle" fill="#64748b" font-family="ui-monospace, monospace" font-size="9.5">Exh</text>
  <text x="${(tqX0 + tqX1) / 2}" y="482" text-anchor="middle" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">Crank Angle (deg) · dashed: mean ${fmt(meanTorque, 1)} N·m</text>
</svg>
`;
}

function main() {
  const [, , workspaceDir, outFile] = process.argv;
  if (!workspaceDir || !outFile) {
    process.stderr.write('Usage: node render.js <workspaceDir> <outFile>\n');
    process.exit(1);
  }
  try {
    const enginePath = path.resolve(workspaceDir, 'src', 'engine.js');
    const engine = require(enginePath);
    if (typeof engine.simulateCycle !== 'function' || typeof engine.netWorkPerCycle !== 'function') {
      throw new Error('src/engine.js must export simulateCycle and netWorkPerCycle');
    }
    const samples1 = engine.simulateCycle(GEOM, STATE, 1);
    if (!Array.isArray(samples1) || samples1.length < 10) {
      throw new Error('simulateCycle returned too few samples');
    }
    for (const s of samples1) {
      if (
        !s ||
        !Number.isFinite(s.thetaDeg) ||
        !Number.isFinite(s.x) ||
        !Number.isFinite(s.V) ||
        !Number.isFinite(s.p) ||
        !Number.isFinite(s.torque)
      ) {
        throw new Error('simulateCycle returned non-finite sample values');
      }
    }
    const netWork = engine.netWorkPerCycle(samples1);
    if (!Number.isFinite(netWork)) {
      throw new Error('netWorkPerCycle returned non-finite value');
    }
    writeOut(outFile, buildSvg(samples1, netWork));
  } catch (err) {
    writeOut(outFile, renderErrorSvg(err && err.message ? err.message : String(err)));
  }
}

main();
