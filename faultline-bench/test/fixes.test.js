'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AGENTS, parsers } = require('../src/agents');
const { runAttempt, runBenchmark } = require('../src/runner');

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

// Runs runBenchmark in a child, signals it once the agent is up. Temp dirs are redirected into `sysTmp`.
function signalRun(sig, workRoot) {
  const dir = fs.mkdtempSync(path.join(tmp, `sig-${sig}-`));
  const sysTmp = path.join(dir, 'systmp');
  fs.mkdirSync(sysTmp);
  const pidFile = path.join(dir, 'agent.pid');
  const script = path.join(dir, 'run.js');
  const agentCode = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  fs.writeFileSync(
    script,
    `const fs = require('fs');
const { runBenchmark } = require(${JSON.stringify(RUNNER)});
const agent = { id: 'fake', name: 'Fake', bin: ['node'], exe: process.execPath, args: () => ['-e', ${JSON.stringify(agentCode)}] };
runBenchmark({ agents: [agent], scenarios: [${JSON.stringify(scenario)}], repeat: 1, timeoutSec: 60, models: {},
  outDir: ${JSON.stringify(path.join(dir, 'od'))}, workRoot: ${JSON.stringify(workRoot)} });
const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(pidFile)})) { clearInterval(t); process.emit(${JSON.stringify(sig)}); } }, 100);
`
  );
  const env = { ...process.env, TMPDIR: sysTmp, TEMP: sysTmp, TMP: sysTmp };
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30000, env });
  return { r, sysTmp, pid: Number(fs.readFileSync(pidFile, 'utf8')) };
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  test(`(d) ${sig}: kills the agent tree, removes the runner's own mkdtemp dir, exits 130`, () => {
    const { r, sysTmp, pid } = signalRun(sig, undefined);
    assert.strictEqual(r.status, 130, r.stderr);
    assert.deepStrictEqual(fs.readdirSync(sysTmp), [], 'runner-created work dir removed');
    assert.throws(() => process.kill(pid, 0), 'agent process killed');
  });

  test(`(d) ${sig}: a caller-supplied workRoot survives`, () => {
    const workRoot = path.join(tmp, `caller-wd-${sig}`);
    fs.mkdirSync(workRoot);
    fs.writeFileSync(path.join(workRoot, 'keep.txt'), 'mine');
    const { r } = signalRun(sig, workRoot);
    assert.strictEqual(r.status, 130, r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(workRoot, 'keep.txt'), 'utf8'), 'mine');
  });
}

test('(f) signal handlers are removed even when an attempt rejects', async () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const broken = { ...scenario, id: 'broken', dir: path.join(tmp, 'does-not-exist') };
  await assert.rejects(
    runBenchmark({ agents: [fakeAgent('')], scenarios: [broken], repeat: 1, models: {}, outDir: path.join(tmp, 'of'), workRoot: path.join(tmp, 'wf') })
  );
  assert.deepStrictEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('(g) agy timeout is plumbed through runAttempt', async () => {
  const agy = AGENTS.find((a) => a.id === 'agy');
  let seen;
  const agent = fakeAgent('', { args: (p, o) => ((seen = agy.args(p, o)), ['-e', '']) });
  await runAttempt({ agent, scenario, rep: 1, workRoot: path.join(tmp, 'wg'), outDir: path.join(tmp, 'og'), timeoutSec: 45 });
  assert.strictEqual(seen[seen.indexOf('--print-timeout') + 1], '45s');
});

test('(h) nothing reads the dropped hasGit field', () => {
  const src = path.join(__dirname, '..', 'src');
  for (const f of fs.readdirSync(src)) assert.doesNotMatch(fs.readFileSync(path.join(src, f), 'utf8'), /hasGit/, f);
});

test('(i) agent-error reason reaches the console and results.json', () => {
  const out = path.join(tmp, 'oi');
  const sysTmp = path.join(tmp, 'systmp-i');
  fs.mkdirSync(sysTmp);
  const r = spawnSync(
    process.execPath,
    [BIN, 'run', '--agent-cmd', 'boom=node -e process.exit(3)', '--agents', 'boom', '--scenarios', 'csv-parser', '-y', '--no-open', '--out', out],
    { encoding: 'utf8', timeout: 120000, env: { ...process.env, TMPDIR: sysTmp, TEMP: sysTmp, TMP: sysTmp } }
  );
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /agent exited with code 3 and made no changes/);
  const [attempt] = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).attempts;
  assert.strictEqual(attempt.category, 'agent_error');
  assert.strictEqual(attempt.reason, 'agent exited with code 3 and made no changes');
});

test('(e) missing git fails fast with a clear message', () => {
  // Point PATH at an empty dir: Windows refills a missing PATH with system defaults.
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faultline-nogit-'));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path')), PATH: emptyDir };
  const code = `require(${JSON.stringify(RUNNER)}).runBenchmark({ agents: [], scenarios: [], repeat: 1, models: {}, outDir: '.' }).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(3); })`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /git is required/);
});
