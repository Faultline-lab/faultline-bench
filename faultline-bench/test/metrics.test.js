'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { passAtK, passHatK, wilson, summarizeAgent, summarizeAll } = require('../src/metrics');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const att = (scenario, passed, extra = {}) => ({
  agent: 'a', scenario, rep: 0, passed, durationMs: 100, costUsd: 0.5, inputTokens: 10, outputTokens: 5, ...extra,
});

test('passAtK and passHatK use the unbiased estimators', () => {
  assert.strictEqual(passAtK(5, 2, 2), 0.7);
  assert.strictEqual(passHatK(5, 2, 2), 0.1);
  assert.strictEqual(passAtK(5, 0, 3), 0);
  assert.strictEqual(passHatK(5, 0, 1), 0);
  assert.strictEqual(passAtK(5, 5, 3), 1);
  assert.strictEqual(passHatK(5, 5, 5), 1);
  near(passAtK(5, 2, 1), 0.4);
  assert.strictEqual(passAtK(3, 1, 4), null);
  assert.strictEqual(passHatK(3, 1, 4), null);
});

test('wilson gives the 95% interval', () => {
  const [lo, hi] = wilson(7, 10);
  near(lo, 0.397, 1e-3);
  near(hi, 0.892, 1e-3);
  assert.strictEqual(wilson(0, 0), null);
});

test('summarizeAgent aggregates per scenario and excludes harness errors', () => {
  const s = summarizeAgent([
    att('x', true), att('x', true), att('x', null),
    att('y', true, { durationMs: 300 }), att('y', false, { durationMs: 200 }),
    att('z', false), att('z', false),
  ]);
  assert.strictEqual(s.runs, 6);
  assert.strictEqual(s.harnessErrors, 1);
  near(s.solveRate, 0.5); // mean of 1, 0.5, 0
  assert.deepStrictEqual(Object.keys(s.passAtK), ['1', '2']);
  near(s.passAtK[1], 0.5);
  near(s.passAtK[2], 2 / 3);
  near(s.passHatK[2], 1 / 3);
  assert.deepStrictEqual(s.flakyScenarios, ['y']);
  assert.deepStrictEqual(s.alwaysPass, ['x']);
  assert.deepStrictEqual(s.alwaysFail, ['z']);
  near(s.solveRateCI[0], wilson(3, 6)[0]);
  near(s.sem, 0.5 / Math.sqrt(3));
  near(s.costPerSolve, 3 / 3);
  near(s.timePerSolveMs, 900 / 3);
  assert.strictEqual(s.medianDurationMs, 100);
  assert.strictEqual(s.totalTokens, 90);
});

test('unknown cost or tokens give null, zero passes give null per-solve', () => {
  const s = summarizeAgent([att('x', true, { costUsd: null, inputTokens: null }), att('x', false)]);
  assert.strictEqual(s.costPerSolve, null);
  assert.strictEqual(s.totalTokens, null);
  assert.strictEqual(s.sem, null);
  const f = summarizeAgent([att('x', false), att('x', false)]);
  assert.strictEqual(f.costPerSolve, null);
  assert.strictEqual(f.timePerSolveMs, null);
  assert.strictEqual(f.solveRate, 0);
});

test('summarizeAll groups by agent', () => {
  const all = summarizeAll([att('x', true), { ...att('x', false), agent: 'b' }]);
  assert.deepStrictEqual(Object.keys(all), ['a', 'b']);
  assert.strictEqual(all.a.solveRate, 1);
  assert.strictEqual(all.b.solveRate, 0);
});
