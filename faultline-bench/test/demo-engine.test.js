'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCENARIO_DIR = path.join(__dirname, '..', 'scenarios', 'engine-sim');
const REPO_DIR = path.join(SCENARIO_DIR, 'repo');
const HIDDEN_DIR = path.join(SCENARIO_DIR, 'hidden');
const SOLUTION_DIR = path.join(SCENARIO_DIR, 'solution');
const RENDER_SCRIPT = path.join(SCENARIO_DIR, 'render', 'render.js');

const tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-engine-sim-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanNodeEnv() {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

function runHiddenTests(workspaceDir) {
  const hiddenDst = path.join(workspaceDir, 'hidden');
  const testFiles = fs
    .readdirSync(hiddenDst)
    .filter((f) => /\.test\.js$/.test(f))
    .map((f) => path.join('hidden', f));
  return spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: cleanNodeEnv(),
    timeout: 30000,
  });
}

function assertValidSvg(filePath) {
  assert.ok(fs.existsSync(filePath), `expected render output at ${filePath}`);
  const stat = fs.statSync(filePath);
  assert.ok(stat.size > 0, 'rendered SVG must be non-empty');
  assert.ok(stat.size < 400 * 1024, `rendered SVG exceeds 400 KB (${stat.size} bytes)`);
  const content = fs.readFileSync(filePath, 'utf8').trimStart();
  assert.ok(
    content.startsWith('<svg') || content.startsWith('<?xml'),
    'rendered output must start with <svg or <?xml'
  );
}

test.after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('engine-sim: buggy repo fails hidden tests, solution passes, and render produces valid SVGs', () => {
  const ws = makeTmpDir();
  fs.cpSync(REPO_DIR, ws, { recursive: true });
  fs.cpSync(HIDDEN_DIR, path.join(ws, 'hidden'), { recursive: true });

  const buggyTests = runHiddenTests(ws);
  assert.notStrictEqual(buggyTests.status, 0, 'hidden tests must FAIL on buggy repo');

  const buggySvg = path.join(ws, 'buggy.svg');
  const renderBuggy = spawnSync(process.execPath, [RENDER_SCRIPT, ws, buggySvg], {
    encoding: 'utf8',
    env: cleanNodeEnv(),
    timeout: 20000,
  });
  assert.strictEqual(renderBuggy.status, 0, `buggy render failed: ${renderBuggy.stderr}`);
  assertValidSvg(buggySvg);

  fs.cpSync(SOLUTION_DIR, ws, { recursive: true });
  const fixedTests = runHiddenTests(ws);
  assert.strictEqual(
    fixedTests.status,
    0,
    `hidden tests must PASS on solution:\n${fixedTests.stdout}\n${fixedTests.stderr}`
  );

  const fixedSvg = path.join(ws, 'fixed.svg');
  const renderFixed = spawnSync(process.execPath, [RENDER_SCRIPT, ws, fixedSvg], {
    encoding: 'utf8',
    env: cleanNodeEnv(),
    timeout: 20000,
  });
  assert.strictEqual(renderFixed.status, 0, `fixed render failed: ${renderFixed.stderr}`);
  assertValidSvg(fixedSvg);

  const buggyText = fs.readFileSync(buggySvg, 'utf8');
  const fixedText = fs.readFileSync(fixedSvg, 'utf8');
  assert.notStrictEqual(buggyText, fixedText, 'buggy and fixed SVGs must visibly differ');
  assert.match(buggyText, /FAULT:/);
  assert.match(fixedText, /NOMINAL CYCLE/);
});

test('engine-sim render writes an error SVG instead of throwing on broken code', () => {
  const ws = makeTmpDir();
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src', 'engine.js'), 'throw new Error("boom");\n');

  const brokenSvg = path.join(ws, 'broken.svg');
  const res = spawnSync(process.execPath, [RENDER_SCRIPT, ws, brokenSvg], {
    encoding: 'utf8',
    env: cleanNodeEnv(),
    timeout: 20000,
  });
  assert.strictEqual(res.status, 0, `broken render must exit 0: ${res.stderr}`);
  assertValidSvg(brokenSvg);
  const text = fs.readFileSync(brokenSvg, 'utf8');
  assert.match(text, /render failed: boom/);
});
