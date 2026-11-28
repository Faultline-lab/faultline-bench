'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCENARIO_DIR = path.join(__dirname, '..', 'scenarios', 'raytracer');
const RENDER_SCRIPT = path.join(SCENARIO_DIR, 'render', 'render.js');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const tmpDirs = [];

function cleanEnv() {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

// Pass test files, not folders: on Node 22+ a folder argument is treated as a module path.
function runNodeTest(cwd, dir) {
  const files = fs.readdirSync(path.join(cwd, dir)).filter((n) => n.endsWith('.test.js')).map((n) => path.join(dir, n));
  return spawnSync(process.execPath, ['--test', ...files], { cwd, encoding: 'utf8', env: cleanEnv(), timeout: 120000 });
}

function renderPng(workDir, outFile) {
  const r = spawnSync(process.execPath, [RENDER_SCRIPT, workDir, outFile], { encoding: 'utf8', env: cleanEnv(), timeout: 20000 });
  assert.equal(r.status, 0, `render exited ${r.status}: ${r.stderr}`);
  assert.ok(fs.existsSync(outFile), `expected render output at ${outFile}`);
  const buf = fs.readFileSync(outFile);
  assert.ok(buf.length > 0 && buf.length < 400 * 1024, `render output is ${buf.length} bytes`);
  assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), 'render output must be a PNG');
  return buf;
}

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

test('raytracer fails hidden tests on repo/, passes on solution/, and renders valid PNGs', () => {
  const tmpRoot = fs.mkdtempSync(path.join(__dirname, '.tmp-raytracer-'));
  tmpDirs.push(tmpRoot);
  const workDir = path.join(tmpRoot, 'workspace');
  fs.cpSync(path.join(SCENARIO_DIR, 'repo'), workDir, { recursive: true });
  fs.cpSync(path.join(SCENARIO_DIR, 'hidden'), path.join(workDir, '.hidden'), { recursive: true });

  const visible = runNodeTest(workDir, 'test');
  assert.equal(visible.status, 0, `visible tests should pass:\n${visible.stdout}\n${visible.stderr}`);

  const buggy = runNodeTest(workDir, '.hidden');
  assert.notEqual(buggy.status, 0, 'hidden tests must fail on starter repo/');
  const buggyPng = renderPng(workDir, path.join(tmpRoot, 'buggy.png'));

  fs.cpSync(path.join(SCENARIO_DIR, 'solution'), workDir, { recursive: true });
  const fixed = runNodeTest(workDir, '.hidden');
  assert.equal(fixed.status, 0, `hidden tests must pass on solution/:\n${fixed.stdout}\n${fixed.stderr}`);
  const fixedPng = renderPng(workDir, path.join(tmpRoot, 'fixed.png'));
  assert.ok(!buggyPng.equals(fixedPng), 'buggy and fixed renders must differ');

  // Broken agent code must still produce an image, not a crash.
  const brokenDir = path.join(tmpRoot, 'broken');
  fs.mkdirSync(path.join(brokenDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'src', 'trace.js'), 'throw new Error("broken module");\n');
  renderPng(brokenDir, path.join(tmpRoot, 'broken.png'));
});
