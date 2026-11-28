'use strict';

const DEFAULT_GEOM = {
  r: 0.045,
  l: 0.15,
  bore: 0.086,
  compressionRatio: 10,
};

const DEFAULT_STATE = {
  pIntake: 101325,
  pExhaust: 101325,
  pAtm: 101325,
  gamma: 1.4,
  qIn: 800,
};

function resolveGeom(geom) {
  const g = { ...DEFAULT_GEOM, ...geom };
  const area = Math.PI * (g.bore / 2) ** 2;
  const displacement = area * 2 * g.r;
  const clearanceVolume =
    g.clearanceVolume != null ? g.clearanceVolume : displacement / (g.compressionRatio - 1);
  const vMax = clearanceVolume + displacement;
  const compressionRatio = vMax / clearanceVolume;
  return { ...g, area, displacement, clearanceVolume, vMax, compressionRatio };
}

function resolveState(state) {
  return { ...DEFAULT_STATE, ...state };
}

function pistonPosition(thetaRad, geom = DEFAULT_GEOM) {
  const g = { ...DEFAULT_GEOM, ...geom };
  const offset = g.r * Math.sin(thetaRad);
  return g.r * Math.cos(thetaRad) + Math.sqrt(g.l * g.l - offset * offset);
}

function volumeFromX(x, g) {
  return g.clearanceVolume + g.area * (g.r + g.l - x);
}

function volume(thetaRad, geom = DEFAULT_GEOM) {
  const g = resolveGeom(geom);
  return volumeFromX(pistonPosition(thetaRad, g), g);
}

function pressure(thetaDeg, state = DEFAULT_STATE, geom) {
  const st = resolveState(state);
  const g = resolveGeom(geom || st.geom);
  const deg = ((thetaDeg % 720) + 720) % 720;
  const V = volume((deg * Math.PI) / 180, g);

  if (deg < 180) return st.pIntake;
  if (deg < 360) return st.pIntake * Math.pow(g.vMax / V, st.gamma);
  if (deg < 540) {
    const p2 = st.pIntake * Math.pow(g.compressionRatio, st.gamma);
    const p3 = p2 + ((st.gamma - 1) * st.qIn) / g.clearanceVolume;
    return p3 * Math.pow(g.clearanceVolume / V, st.gamma);
  }
  return st.pExhaust;
}

function torque(thetaDeg, geom = DEFAULT_GEOM, state = DEFAULT_STATE) {
  const g = resolveGeom(geom);
  const st = resolveState(state);
  const thetaRad = (thetaDeg * Math.PI) / 180;
  const p = pressure(thetaDeg, st, g);
  const pAtm = st.pAtm != null ? st.pAtm : st.pIntake;
  const force = (p - pAtm) * g.area;
  const sinBeta = (g.r / g.l) * Math.sin(thetaRad);
  const cosBeta = Math.sqrt(1 - sinBeta * sinBeta);
  const leverArm = (g.r * Math.sin(thetaRad + Math.asin(sinBeta))) / cosBeta;
  return force * leverArm;
}

function simulateCycle(geom = DEFAULT_GEOM, state = DEFAULT_STATE, stepDeg = 1) {
  const g = resolveGeom(geom);
  const st = resolveState(state);
  const steps = Math.round(720 / stepDeg);
  const samples = [];
  for (let i = 0; i < steps; i++) {
    const thetaDeg = i * stepDeg;
    const thetaRad = (thetaDeg * Math.PI) / 180;
    const x = pistonPosition(thetaRad, g);
    const V = volumeFromX(x, g);
    const p = pressure(thetaDeg, st, g);
    const t = torque(thetaDeg, g, st);
    samples.push({ thetaDeg, x, V, p, torque: t });
  }
  return samples;
}

function netWorkPerCycle(geomOrSamples = DEFAULT_GEOM, state = DEFAULT_STATE, stepDeg = 1) {
  const samples = Array.isArray(geomOrSamples)
    ? geomOrSamples
    : simulateCycle(geomOrSamples, state, stepDeg);
  let work = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    work += 0.5 * (a.p + b.p) * (b.V - a.V);
  }
  return work;
}

module.exports = {
  DEFAULT_GEOM,
  DEFAULT_STATE,
  pistonPosition,
  volume,
  pressure,
  torque,
  simulateCycle,
  netWorkPerCycle,
};
