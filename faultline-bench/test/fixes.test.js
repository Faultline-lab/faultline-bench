'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AGENTS, parsers } = require('../src/agents');
const { runAttempt } = require('../src/runner');

const RUNNER = path.join(__dirname, '..', 'src', 'runner.js');
const BIN = path.join(__dirname, '..', 'bin', 'faultline.js');
const tmp = fs.mkdtempSync(path.join(__dirname, '.tmp-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Minimal scenario: one hidden test that fails until index.js is fixed.
const scenario = { id: 'fixture', title: 'Fixture', task: 'Make ok() return true.', dir: path.join(tmp, 'scenario') };
fs.mkdirSync(path.join(scenario.dir, 'repo'), { recursive: true });
fs.mkdirSync(path.join(scenario.dir, 'hidden'), { recursive: true });
fs.writeFileSync(path.join(scenario.dir, 'repo', 'index.js'), 'exports.ok = () => false;\n');
fs.writeFileSync(
  path.join(scenario.dir, 'hidden', 'a.test.js'),
  "require('node:test')('ok', () => require('node:assert')(require('../index.js').ok()));\n"
);

const fakeAgent = (code, extra = {}) => ({
  id: 'fake',
  name: 'Fake',
  bin: ['node'],
  exe: process.execPath,
  args: () => ['-e', code],
  parseUsage: parsers.parseGeneric,
  ...extra,
});

test('(a) exit 0 + reported error + no changes -> agent_error with reason', async () => {
  const agent = fakeAgent(`console.log(JSON.stringify({ type: 'result', is_error: true }))`, { parseUsage: parsers.parseClaude });
  const r = await runAttempt({ agent, scenario, rep: 1, workRoot: path.join(tmp, 'wa'), outDir: path.join(tmp, 'oa'), timeoutSec: 60 });
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.agentReportedError, true);
  assert.strictEqual(r.category, 'agent_error');
  assert.match(r.reason, /reported an error/);
});

test('(b) agy --print-timeout follows the attempt timeout', () => {
  const agy = AGENTS.find((a) => a.id === 'agy');
  const args = agy.args('p', { workspace: 'w', timeoutSec: 90 });
  assert.strictEqual(args[args.indexOf('--print-timeout') + 1], '90s');
});

test('(c) Node 18.18 is rejected with the required version', () => {
  // process.versions is read-only, so run the bin script against a fake process.
  const src = fs.readFileSync(BIN, 'utf8').replace(/^#!.*/, '');
  const run = (version) => {
    let err = '';
    const sandbox = {
      process: { versions: { node: version }, argv: [], exit: (c) => { throw { exit: c }; } },
      console: { error: (m) => (err += m) },
      require: () => ({ main: () => new Promise(() => {}) }),
    };
    try {
      require('node:vm').runInNewContext(src, sandbox);
    } catch (e) {
      return { exit: e.exit, err };
    }
    return { exit: null, err };
  };
  const old = run('18.18.2');
  assert.strictEqual(old.exit, 1);
  assert.match(old.err, /18\.19/);
  assert.strictEqual(run('18.19.0').exit, null);
  assert.strictEqual(run('20.1.0').exit, null);
});

test('(d) SIGINT kills the agent tree, removes work dirs, exits 130', () => {
  const pidFile = path.join(tmp, 'agent.pid');
  const workRoot = path.join(tmp, 'wd');
  const script = path.join(tmp, 'sigint.js');
  const agentCode = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  fs.writeFileSync(
    script,
    `const fs = require('fs');
const { runBenchmark } = require(${JSON.stringify(RUNNER)});
const agent = { id: 'fake', name: 'Fake', bin: ['node'], exe: process.execPath, args: () => ['-e', ${JSON.stringify(agentCode)}] };
runBenchmark({ agents: [agent], scenarios: [${JSON.stringify(scenario)}], repeat: 1, timeoutSec: 60, models: {},
  outDir: ${JSON.stringify(path.join(tmp, 'od'))}, workRoot: ${JSON.stringify(workRoot)} });
const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(pidFile)})) { clearInterval(t); process.emit('SIGINT'); } }, 100);
`
  );
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(r.status, 130, r.stderr);
  assert.ok(!fs.existsSync(workRoot), 'work dir removed');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), 'agent process killed');
});

test('(e) missing git fails fast with a clear message', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'));
  const code = `require(${JSON.stringify(RUNNER)}).runBenchmark({ agents: [], scenarios: [], repeat: 1, models: {}, outDir: '.' }).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(3); })`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /git is required/);
});
