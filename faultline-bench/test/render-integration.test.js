'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runAttempt } = require('../src/runner');

const tmp = fs.mkdtempSync(path.join(__dirname, '.tmp-render-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));

function makeScenario(name, renderJs) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'repo', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'hidden'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'repo', 'src', 'ok.js'), 'exports.ok = () => false;\n');
  fs.writeFileSync(
    path.join(dir, 'hidden', 'a.test.js'),
    "require('node:test')('ok', () => require('node:assert')(require('../src/ok.js').ok()));\n"
  );
  const scenario = { id: name, title: name, task: 'Make ok() return true.', dir };
  if (renderJs) {
    fs.mkdirSync(path.join(dir, 'render'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'render', 'render.js'), renderJs);
    scenario.render = 'svg';
  }
  return scenario;
}

// A fake agent: a node script that fixes ok.js and prints the given stdout.
function fakeAgent(id, stdout) {
  const script = path.join(tmp, `${id}.js`);
  fs.writeFileSync(
    script,
    `require('fs').writeFileSync('src/ok.js', 'exports.ok = () => true;\\n'); process.stdout.write(${JSON.stringify(stdout)});\n`
  );
  return { id, name: id, bin: ['node'], exe: process.execPath, args: () => [script] };
}

const RENDER_OK = `const fs = require('fs'); const path = require('path');
const [ws, out] = process.argv.slice(2);
const ok = require(path.join(ws, 'src', 'ok.js')).ok();
fs.writeFileSync(out, '<svg xmlns="http://www.w3.org/2000/svg"><text>' + (ok ? 'fixed' : 'buggy') + '</text></svg>');
`;

test('a scenario with a render script gets a picture of the agent result', async () => {
  const scenario = makeScenario('pic', RENDER_OK);
  const out = path.join(tmp, 'out1');
  const r = await runAttempt({ agent: fakeAgent('fixer', 'done'), scenario, rep: 1, workRoot: path.join(tmp, 'w1'), outDir: out, timeoutSec: 60 });
  assert.equal(r.passed, true, `${r.category}: ${r.reason} ${JSON.stringify(r.tests)} render=${r.renderError}`);
  assert.equal(r.files.render, 'attempts/fixer__pic__r1.render.svg');
  assert.match(fs.readFileSync(path.join(out, r.files.render), 'utf8'), /fixed/);
  assert.equal(r.renderError, null);
});

test('a render script that crashes is recorded, not fatal', async () => {
  const scenario = makeScenario('crash', "throw new Error('kaboom');\n");
  const r = await runAttempt({ agent: fakeAgent('fixer', 'done'), scenario, rep: 1, workRoot: path.join(tmp, 'w2'), outDir: path.join(tmp, 'out2'), timeoutSec: 60 });
  assert.equal(r.passed, true, `${r.category}: ${r.reason} ${JSON.stringify(r.tests)} render=${r.renderError}`);
  assert.equal(r.files.render, null);
  assert.match(r.renderError, /kaboom|exited/);
});

test('scenarios without a render script have no picture', async () => {
  const scenario = makeScenario('plain', null);
  const r = await runAttempt({ agent: fakeAgent('fixer', 'done'), scenario, rep: 1, workRoot: path.join(tmp, 'w3'), outDir: path.join(tmp, 'out3'), timeoutSec: 60 });
  assert.equal(r.files.render, null);
});

test('web lookups in the agent output are flagged on the attempt', async () => {
  const scenario = makeScenario('web', null);
  const line = JSON.stringify({ type: 'tool_use', name: 'WebSearch', input: { query: 'pagination off by one fix' } });
  const r = await runAttempt({ agent: fakeAgent('searcher', `${line}\n`), scenario, rep: 1, workRoot: path.join(tmp, 'w4'), outDir: path.join(tmp, 'out4'), timeoutSec: 60 });
  assert.equal(r.webLookup.detected, true);
  assert.ok(r.webLookup.evidence.length > 0);
  const clean = await runAttempt({ agent: fakeAgent('quiet', 'all done'), scenario, rep: 2, workRoot: path.join(tmp, 'w5'), outDir: path.join(tmp, 'out5'), timeoutSec: 60 });
  assert.equal(clean.webLookup.detected, false);
});

test('the agent sees no tool name or task id in its folder name or git history', async () => {
  const scenario = makeScenario('secret-task-id', null);
  const workRoot = path.join(tmp, 'w6');
  const probe = path.join(tmp, 'probe-leak.js');
  // execFileSync, not execSync: cmd.exe would expand %an% as an environment variable.
  fs.writeFileSync(
    probe,
    [
      "const { execFileSync } = require('child_process');",
      "const log = execFileSync('git', ['log', '--format=%an%n%ae%n%s']).toString();",
      "console.log(require('path').basename(process.cwd()));",
      'console.log(log);',
    ].join('\n')
  );
  const agent = { id: 'prober', name: 'prober', bin: ['node'], exe: process.execPath, args: () => [probe] };
  const r = await runAttempt({ agent, scenario, rep: 1, workRoot, outDir: path.join(tmp, 'out6'), timeoutSec: 60 });
  const seen = fs.readFileSync(path.join(tmp, 'out6', r.files.log), 'utf8').split('\n').slice(2).join('\n');
  assert.ok(seen.trim().length > 0, 'probe printed what it saw');
  assert.doesNotMatch(seen, /faultline|secret-task-id|prober/i, `agent could see: ${seen}`);
});

test('reference pictures are rendered from the solution, only for visual scenarios', async () => {
  const { renderReferences } = require('../src/runner');
  const visual = makeScenario('ref-pic', RENDER_OK);
  fs.mkdirSync(path.join(visual.dir, 'solution', 'src'), { recursive: true });
  fs.writeFileSync(path.join(visual.dir, 'solution', 'src', 'ok.js'), 'exports.ok = () => true;\n');
  const plain = makeScenario('ref-plain', null);
  const out = path.join(tmp, 'out7');
  const refs = await renderReferences([visual, plain], out);
  assert.deepEqual(Object.keys(refs), ['ref-pic']);
  assert.equal(refs['ref-pic'], 'reference/ref-pic.render.svg');
  assert.match(fs.readFileSync(path.join(out, refs['ref-pic']), 'utf8'), /fixed/);
});
