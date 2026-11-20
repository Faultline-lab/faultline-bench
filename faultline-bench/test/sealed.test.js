'use strict';
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScenarios, sealScenario } = require('../src/scenarios');
const { runBenchmark, suspiciousAccess } = require('../src/runner');
const { findBuiltin } = require('../src/agents');

const TMP = path.join(__dirname, '.tmp', 'sealed');
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Copies one scenario, seals it, and deletes the plain hidden/ and solution/ folders,
// which is exactly what an installed npm package looks like.
function sealedCopy(id) {
  const src = loadScenarios().find((s) => s.id === id);
  const root = path.join(TMP, 'scenarios');
  const dir = path.join(root, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(src.dir, dir, { recursive: true });
  sealScenario({ ...src, dir });
  fs.rmSync(path.join(dir, 'hidden'), { recursive: true });
  fs.rmSync(path.join(dir, 'solution'), { recursive: true });
  return loadScenarios(root).find((s) => s.id === id);
}

test('grading works from sealed.gz alone, as in the installed package', async () => {
  const scenario = sealedCopy('lru-cache');
  const { results } = await runBenchmark({
    agents: [findBuiltin('oracle'), findBuiltin('noop')],
    scenarios: [scenario],
    repeat: 1,
    models: {},
    outDir: path.join(TMP, 'out'),
    workRoot: path.join(TMP, 'work'),
  });
  assert.equal(results.find((r) => r.agent === 'oracle').passed, true);
  assert.equal(results.find((r) => r.agent === 'noop').passed, false);
});

test('a file the agent planted at .faultline-hidden does not break grading', async () => {
  const scenario = sealedCopy('pagination-off-by-one');
  fs.writeFileSync(path.join(scenario.dir, 'repo', '.faultline-hidden'), 'planted by agent');
  const { results } = await runBenchmark({
    agents: [findBuiltin('oracle')],
    scenarios: [scenario],
    repeat: 1,
    models: {},
    outDir: path.join(TMP, 'out2'),
    workRoot: path.join(TMP, 'work2'),
  });
  assert.equal(results[0].passed, true);
  assert.equal(results[0].tests.total, 10);
});

test('suspiciousAccess flags output that touches grading files', () => {
  assert.equal(suspiciousAccess('cat /usr/lib/node_modules/faultline-bench/scenarios/x/sealed.gz'), true);
  assert.equal(suspiciousAccess('dir I:\\npm\\node_modules\\faultline-bench\\scenarios'), true);
  assert.equal(suspiciousAccess('ls .faultline-hidden'), true);
  assert.equal(suspiciousAccess('edited src/cache.js and ran npm test'), false);
});
