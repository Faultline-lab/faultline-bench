'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runBenchmark } = require('../src/runner');
const { findBuiltin } = require('../src/agents');
const { loadScenarios } = require('../src/scenarios');

const TMP = path.join(__dirname, '.tmp');

test('oracle passes every scenario and noop passes none', { timeout: 600000 }, async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  const scenarios = loadScenarios();
  // Grading spawns `node --test`; inherited NODE_TEST_CONTEXT makes it skip nested runs.
  const savedContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const { results } = await runBenchmark({
      agents: [findBuiltin('oracle'), findBuiltin('noop')],
      scenarios,
      repeat: 1,
      models: {},
      outDir: path.join(TMP, 'out'),
      workRoot: path.join(TMP, 'work'),
      parallel: 2,
    });

    assert.equal(results.length, scenarios.length * 2);
    for (const r of results.filter((x) => x.agent === 'oracle')) {
      assert.equal(r.category, 'passed', `oracle failed ${r.scenario} (${r.category})`);
    }
    for (const r of results.filter((x) => x.agent === 'noop')) {
      assert.equal(r.category, 'no_changes', `noop got ${r.category} on ${r.scenario}`);
    }
  } finally {
    if (savedContext !== undefined) process.env.NODE_TEST_CONTEXT = savedContext;
  }
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
