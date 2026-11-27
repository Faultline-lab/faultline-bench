'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runAttempt } = require('../src/runner');
const { loadScenarios } = require('../src/scenarios');
const { resolveLaunch } = require('../src/util');

const tmp = fs.mkdtempSync(path.join(__dirname, '.tmp-polish-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Minimal scenario: one hidden test that fails until index.js is fixed.
const scenario = { id: 'polish', title: 'Polish', task: 'Make ok() return true.', dir: path.join(tmp, 'scenario') };
fs.mkdirSync(path.join(scenario.dir, 'repo'), { recursive: true });
fs.mkdirSync(path.join(scenario.dir, 'hidden'), { recursive: true });
fs.writeFileSync(path.join(scenario.dir, 'repo', 'index.js'), 'exports.ok = () => false;\n');
fs.writeFileSync(
  path.join(scenario.dir, 'hidden', 'a.test.js'),
  "require('node:test')('ok', () => require('node:assert')(require('../index.js').ok()));\n"
);

test('(1) a spawn failure says the agent could not be started', async () => {
  const agent = {
    id: 'missing',
    name: 'Missing',
    bin: ['nope'],
    exe: path.join(tmp, 'no-such-dir', 'nope.exe'),
    args: () => [],
  };
  const r = await runAttempt({ agent, scenario, rep: 1, workRoot: path.join(tmp, 'w1'), outDir: path.join(tmp, 'o1'), timeoutSec: 60 });
  assert.strictEqual(r.exitCode, -1);
  assert.strictEqual(r.category, 'agent_error');
  assert.match(r.reason, /^agent could not be started: .+/);
});

test('(2) every scenario repo ignores node_modules', () => {
  const scenarios = loadScenarios();
  assert.strictEqual(scenarios.length, 6);
  for (const s of scenarios) {
    const file = path.join(s.dir, 'repo', '.gitignore');
    assert.ok(fs.existsSync(file), `${s.id} has a .gitignore`);
    assert.match(fs.readFileSync(file, 'utf8'), /^node_modules\/$/m, `${s.id} ignores node_modules`);
  }
});

test('(2) node_modules written by an agent is not a reported change', async () => {
  const real = loadScenarios().find((s) => s.id === 'pagination-off-by-one');
  const outDir = path.join(tmp, 'o2');
  const seenFile = path.join(tmp, 'seen.json');
  const code = [
    "const fs = require('fs');",
    `fs.writeFileSync(${JSON.stringify(seenFile)}, JSON.stringify({ gitignore: fs.existsSync('.gitignore') }));`,
    "fs.mkdirSync('node_modules', { recursive: true });",
    "fs.writeFileSync('node_modules/x.js', 'x');",
  ].join('');
  const agent = { id: 'fake', name: 'Fake', bin: ['node'], exe: process.execPath, args: () => ['-e', code] };
  const r = await runAttempt({ agent, scenario: real, rep: 1, workRoot: path.join(tmp, 'w2'), outDir, timeoutSec: 120 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(seenFile, 'utf8')), { gitignore: true }, '.gitignore reached the workspace');
  assert.deepStrictEqual(r.changes.files, []);
  assert.strictEqual(r.category, 'no_changes');
});

test('(3) a .cmd shim that calls PowerShell launches the .ps1 directly', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'shim-'));
  const ps1 = path.join(dir, 'cursor-agent.ps1');
  fs.writeFileSync(ps1, '# fake\n');
  const cmd = path.join(dir, 'cursor-agent.cmd');
  fs.writeFileSync(cmd, '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\\cursor-agent.ps1" %*\r\n');
  const launch = resolveLaunch(cmd, ['run', '--auto']);
  assert.strictEqual(launch.shell, false);
  assert.match(launch.command, /powershell(\.exe)?$/i);
  assert.deepStrictEqual(launch.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, 'run', '--auto']);
});
