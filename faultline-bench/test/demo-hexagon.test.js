'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCENARIO_DIR = path.join(__dirname, '..', 'scenarios', 'spinning-hexagon');
const RENDER_SCRIPT = path.join(SCENARIO_DIR, 'render', 'render.js');

const tmpDirs = [];

function cleanEnv() {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

function runNodeTest(cwd, files) {
  return spawnSync(process.execPath, ['--test', ...files], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
    timeout: 60000,
  });
}

function assertValidSvg(filePath) {
  assert.ok(fs.existsSync(filePath), `expected render output at ${filePath}`);
  const stat = fs.statSync(filePath);
  assert.ok(stat.size > 0, 'render output must be non-empty');
  assert.ok(stat.size < 400 * 1024, `render output ${stat.size} bytes must be under 400 KB`);
  const content = fs.readFileSync(filePath, 'utf8').trimStart();
  assert.ok(
    content.startsWith('<svg') || content.startsWith('<?xml'),
    'render output must be valid SVG starting with <svg or <?xml'
  );
  assert.ok(content.includes('</svg>'), 'render output must close </svg>');
  return content;
}

test.after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('spinning-hexagon fails hidden tests on repo/, passes on solution/, and renders valid SVGs', () => {
  const tmpRoot = fs.mkdtempSync(path.join(__dirname, '.tmp-spinning-hexagon-'));
  tmpDirs.push(tmpRoot);

  const workDir = path.join(tmpRoot, 'workspace');
  fs.cpSync(path.join(SCENARIO_DIR, 'repo'), workDir, { recursive: true });
  fs.cpSync(path.join(SCENARIO_DIR, 'hidden'), path.join(workDir, '.hidden'), { recursive: true });

  // Visible repo tests pass on starter repo
  const visibleRes = runNodeTest(workDir, ['test']);
  assert.equal(visibleRes.status, 0, `visible tests should pass:\n${visibleRes.stdout}\n${visibleRes.stderr}`);

  // (1) Hidden tests must FAIL on buggy repo/
  const buggyRes = runNodeTest(workDir, ['.hidden']);
  assert.notEqual(buggyRes.status, 0, 'hidden tests must fail on starter repo/');

  // (3a) Render buggy workspace
  const buggySvgPath = path.join(tmpRoot, 'buggy.svg');
  const buggyRender = spawnSync(process.execPath, [RENDER_SCRIPT, workDir, buggySvgPath], {
    encoding: 'utf8',
    env: cleanEnv(),
    timeout: 20000,
  });
  assert.equal(buggyRender.status, 0, `buggy render exited ${buggyRender.status}: ${buggyRender.stderr}`);
  const buggySvg = assertValidSvg(buggySvgPath);
  assert.match(buggySvg, /escaped: [1-9]/);

  // (2) Overlay solution/ and assert hidden tests PASS
  fs.cpSync(path.join(SCENARIO_DIR, 'solution'), workDir, { recursive: true });
  const fixedRes = runNodeTest(workDir, ['.hidden']);
  assert.equal(fixedRes.status, 0, `hidden tests must pass on solution/:\n${fixedRes.stdout}\n${fixedRes.stderr}`);

  // (3b) Render fixed workspace
  const fixedSvgPath = path.join(tmpRoot, 'fixed.svg');
  const fixedRender = spawnSync(process.execPath, [RENDER_SCRIPT, workDir, fixedSvgPath], {
    encoding: 'utf8',
    env: cleanEnv(),
    timeout: 20000,
  });
  assert.equal(fixedRender.status, 0, `fixed render exited ${fixedRender.status}: ${fixedRender.stderr}`);
  const fixedSvg = assertValidSvg(fixedSvgPath);
  assert.match(fixedSvg, /escaped: 0/);

  // (3c) Render broken workspace without throwing
  const brokenDir = path.join(tmpRoot, 'broken');
  fs.mkdirSync(path.join(brokenDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'src', 'sim.js'), 'throw new Error("broken module");\n');
  const brokenSvgPath = path.join(tmpRoot, 'broken.svg');
  const brokenRender = spawnSync(process.execPath, [RENDER_SCRIPT, brokenDir, brokenSvgPath], {
    encoding: 'utf8',
    env: cleanEnv(),
    timeout: 20000,
  });
  assert.equal(brokenRender.status, 0, `broken render exited ${brokenRender.status}: ${brokenRender.stderr}`);
  const brokenSvg = assertValidSvg(brokenSvgPath);
  assert.match(brokenSvg, /render failed:/);
});
