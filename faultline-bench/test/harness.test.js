'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'faultline.js');
const CWD = path.join(__dirname, '..');
const tmpDirs = [];

function mkOut() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faultline-test-'));
  tmpDirs.push(dir);
  return dir;
}

function runSuite(agent) {
  const out = mkOut();
  // node --test sets NODE_TEST_CONTEXT for its children; the CLI spawns its own
  // `node --test` graders, which refuse to run when that variable is inherited.
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const r = spawnSync(
    process.execPath,
    [BIN, 'run', '--agents', agent, '--suite', 'full', '-y', '--no-open', '--out', out],
    { cwd: CWD, encoding: 'utf8', env, timeout: 300000 }
  );
  const report = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  return { r, report };
}

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

test('oracle solves all six full-suite scenarios', () => {
  const { r, report } = runSuite('oracle');
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const row = report.summary.find((s) => s.agent === 'oracle');
  assert.strictEqual(row.attempts, 6);
  assert.strictEqual(row.passed, 6);
  assert.strictEqual(row.solveRate, 1);
});

test('noop solves none of the six full-suite scenarios', () => {
  const { r, report } = runSuite('noop');
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const row = report.summary.find((s) => s.agent === 'noop');
  assert.strictEqual(row.attempts, 6);
  assert.strictEqual(row.passed, 0);
});
