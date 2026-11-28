'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pistonPosition,
  volume,
  pressure,
  torque,
  simulateCycle,
  netWorkPerCycle,
} = require('../src/engine');

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

const AREA = Math.PI * (GEOM.bore / 2) ** 2;
const DISPLACEMENT = AREA * 2 * GEOM.r;
const CLEARANCE = DISPLACEMENT / (GEOM.compressionRatio - 1);

test('piston at TDC at theta=0 and BDC at 180 deg with stroke = 2r', () => {
  const xTdc = pistonPosition(0, GEOM);
  const xBdc = pistonPosition(Math.PI, GEOM);
  assert.ok(Math.abs(xTdc - (GEOM.r + GEOM.l)) < 1e-12);
  assert.ok(Math.abs(xBdc - (GEOM.l - GEOM.r)) < 1e-12);
  assert.ok(Math.abs(xTdc - xBdc - 2 * GEOM.r) < 1e-12);

  const samples = simulateCycle(GEOM, STATE, 1);
  const s0 = samples.find((s) => s.thetaDeg === 0);
  const s180 = samples.find((s) => s.thetaDeg === 180);
  assert.ok(Math.abs(s0.x - xTdc) < 1e-12, 'simulateCycle TDC x mismatch');
  assert.ok(Math.abs(s180.x - xBdc) < 1e-12, 'simulateCycle BDC x mismatch');
});

test('volume equals clearance volume at TDC and clearance + displacement at BDC', () => {
  const vTdc = volume(0, GEOM);
  const vBdc = volume(Math.PI, GEOM);
  assert.ok(Math.abs(vTdc - CLEARANCE) < 1e-12);
  assert.ok(Math.abs(vBdc - (CLEARANCE + DISPLACEMENT)) < 1e-12);

  const samples = simulateCycle(GEOM, STATE, 1);
  const s180 = samples.find((s) => s.thetaDeg === 180);
  assert.ok(Math.abs(s180.V - (CLEARANCE + DISPLACEMENT)) < 1e-12);
});

test('peak pressure occurs within 20 deg after 360 deg (compression TDC)', () => {
  const samples = simulateCycle(GEOM, STATE, 1);
  let peak = samples[0];
  for (const s of samples) {
    if (s.p > peak.p) peak = s;
  }
  assert.ok(
    peak.thetaDeg >= 360 && peak.thetaDeg <= 380,
    `expected peak pressure in [360, 380] deg, got ${peak.thetaDeg} deg`
  );
  assert.ok(pressure(360, STATE, GEOM) > pressure(180, STATE, GEOM) * 10);
});

test('net work per cycle is positive and within 2% of analytic Otto-cycle work', () => {
  const etaOtto = 1 - Math.pow(GEOM.compressionRatio, 1 - STATE.gamma);
  const analyticWork =
    STATE.qIn * etaOtto + (STATE.pIntake - STATE.pExhaust) * DISPLACEMENT;

  const work = netWorkPerCycle(GEOM, STATE, 1);
  assert.ok(work > 0, `expected positive net work, got ${work}`);
  const relErr = Math.abs(work - analyticWork) / analyticWork;
  assert.ok(
    relErr <= 0.02,
    `netWorkPerCycle (${work.toFixed(3)}) differs from analytic (${analyticWork.toFixed(3)}) by ${(relErr * 100).toFixed(2)}%`
  );
});

test('mean torque over the cycle is positive and torque is zero at TDC and BDC', () => {
  const samples = simulateCycle(GEOM, STATE, 1);
  const meanTorque = samples.reduce((acc, s) => acc + s.torque, 0) / samples.length;
  assert.ok(meanTorque > 0, `expected positive mean torque, got ${meanTorque}`);

  for (const deg of [0, 180, 360, 540, 720]) {
    const t = torque(deg, GEOM, STATE);
    assert.ok(Math.abs(t) < 1e-6, `expected zero torque at ${deg} deg, got ${t}`);
  }
});

test('torque includes connecting-rod angle lever arm and integrates to net work', () => {
  const samples = simulateCycle(GEOM, STATE, 1);
  const dTheta = (1 * Math.PI) / 180;
  let workFromTorque = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    workFromTorque += 0.5 * (a.torque + b.torque) * dTheta;
  }
  const workFromPV = netWorkPerCycle(samples);
  const relErr = Math.abs(workFromTorque - workFromPV) / workFromPV;
  assert.ok(
    relErr <= 0.02,
    `torque integral (${workFromTorque.toFixed(3)}) must match P-V work (${workFromPV.toFixed(3)})`
  );

  // Verify connecting-rod ratio term at 450 deg (90 deg into power stroke):
  // At theta = 450 deg, sin(theta) = 1, cos(theta) = 0, so check 405 deg (45 deg past TDC).
  const deg = 405;
  const rad = (deg * Math.PI) / 180;
  const p = pressure(deg, { ...STATE, geom: GEOM });
  const force = (p - STATE.pAtm) * AREA;
  const sinBeta = (GEOM.r / GEOM.l) * Math.sin(rad);
  const expectedLever = (GEOM.r * Math.sin(rad + Math.asin(sinBeta))) / Math.sqrt(1 - sinBeta * sinBeta);
  const expectedTorque = force * expectedLever;
  const actualTorque = torque(deg, GEOM, STATE);
  assert.ok(
    Math.abs(actualTorque - expectedTorque) / expectedTorque < 1e-6,
    `torque at ${deg} deg should be ${expectedTorque.toFixed(3)}, got ${actualTorque.toFixed(3)}`
  );
});
