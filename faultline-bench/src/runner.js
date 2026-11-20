'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, runSync, which, rmrf } = require('./util');
const { PROMPT, runBuiltin } = require('./agents');

const GIT_ID = ['-c', 'user.email=bench@faultline.local', '-c', 'user.name=Faultline Bench', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const HIDDEN_DIR = '.faultline-hidden';

function git(cwd, args) {
  return runSync('git', [...GIT_ID, ...args], { cwd, maxBuffer: 32 * 1024 * 1024 });
}

/** Creates an isolated copy of the scenario's starting snapshot, with a git baseline. */
function prepareWorkspace(scenario, workspace, hasGit) {
  rmrf(workspace);
  fs.mkdirSync(workspace, { recursive: true });
  fs.cpSync(path.join(scenario.dir, 'repo'), workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'TASK.md'), `# Task: ${scenario.title}\n\n${scenario.task.trim()}\n`);
  if (hasGit) {
    git(workspace, ['init', '-q']);
    git(workspace, ['add', '-A']);
    git(workspace, ['commit', '-q', '-m', 'faultline baseline']);
  }
}

function captureDiff(workspace, hasGit) {
  if (!hasGit) return { diff: '', files: [], insertions: 0, deletions: 0 };
  git(workspace, ['add', '-A']);
  const diff = git(workspace, ['diff', '--cached', '--no-color']).stdout;
  const numstat = git(workspace, ['diff', '--cached', '--numstat']).stdout;
  let insertions = 0;
  let deletions = 0;
  const files = [];
  for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
    const [a, d, f] = line.split('\t');
    insertions += Number(a) || 0;
    deletions += Number(d) || 0;
    files.push(f);
  }
  return { diff, files, insertions, deletions };
}

function parseTap(out) {
  const num = (k) => {
    const m = out.match(new RegExp(`^# ${k} (\\d+)`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const total = num('tests');
  const passed = num('pass');
  const failed = num('fail');
  const failures = [];
  for (const m of out.matchAll(/^\s*not ok \d+ - (.+)$/gm)) failures.push(m[1].trim());
  return { total: total || 0, passed: passed || 0, failed: failed || 0, failures: failures.slice(0, 20), ran: total !== null };
}

/** Copies hidden tests into the workspace and runs them with node --test. */
async function grade(scenario, workspace) {
  const hiddenSrc = path.join(scenario.dir, 'hidden');
  const hiddenDst = path.join(workspace, HIDDEN_DIR);
  rmrf(hiddenDst);
  fs.cpSync(hiddenSrc, hiddenDst, { recursive: true });
  const files = fs
    .readdirSync(hiddenDst)
    .filter((f) => /\.test\.(c?js|mjs)$/.test(f))
    .map((f) => path.join(HIDDEN_DIR, f));
  const r = await run(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: workspace,
    timeoutMs: 120000,
    raw: true,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  const tap = parseTap(r.stdout);
  rmrf(hiddenDst);
  return { ...tap, timedOut: r.timedOut, output: (r.stdout + r.stderr).slice(-20000) };
}

function classify({ agentResult, tests, changes }) {
  if (tests.ran && tests.total > 0 && tests.failed === 0 && tests.passed === tests.total) return 'passed';
  if (agentResult.timedOut) return 'timeout';
  if (changes.files.length === 0) return agentResult.code !== 0 ? 'agent_error' : 'no_changes';
  if (!tests.ran || tests.timedOut) return 'broken_code';
  return 'tests_failed';
}

const CATEGORY_LABEL = {
  passed: 'Passed',
  timeout: 'Timed out',
  agent_error: 'Agent crashed or refused',
  no_changes: 'Made no changes',
  broken_code: 'Code does not load / tests crash',
  tests_failed: 'Wrong behavior (tests fail)',
};

/**
 * Runs one attempt: fresh workspace -> agent -> diff -> hidden tests -> result record.
 */
async function runAttempt({ agent, scenario, rep, workRoot, outDir, timeoutSec, model, hasGit, onLine }) {
  const slug = `${agent.id}__${scenario.id}__r${rep}`;
  const workspace = path.join(workRoot, slug);
  const attemptDir = path.join(outDir, 'attempts');
  fs.mkdirSync(attemptDir, { recursive: true });
  const logFile = path.join(attemptDir, `${slug}.log`);
  fs.writeFileSync(logFile, '');

  prepareWorkspace(scenario, workspace, hasGit);
  const timeoutMs = (timeoutSec || scenario.timeoutSec || 600) * 1000;
  const startedAt = new Date().toISOString();

  let agentResult;
  if (agent.builtin) {
    agentResult = runBuiltin(agent, scenario, workspace);
  } else {
    const args = agent.args(PROMPT, { model, workspace });
    fs.appendFileSync(logFile, `$ ${agent.bin[0]} ${args.map((a) => (a === PROMPT ? '"<prompt>"' : a)).join(' ')}\n\n`);
    agentResult = await run(agent.exe, args, {
      cwd: workspace,
      timeoutMs,
      logFile,
      onLine,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    if (agentResult.error) fs.appendFileSync(logFile, `\n[faultline] failed to start: ${agentResult.error.message || agentResult.error}\n`);
    if (agentResult.timedOut) fs.appendFileSync(logFile, `\n[faultline] killed after ${timeoutMs / 1000}s timeout\n`);
  }

  const changes = captureDiff(workspace, hasGit);
  const tests = await grade(scenario, workspace);
  const usage = agent.parseUsage ? agent.parseUsage(agentResult.stdout || '', agentResult.stderr || '') : {};
  const category = classify({ agentResult, tests, changes });
  const touchedTests = changes.files.filter((f) => /(^|\/)test\//.test(f) || /\.test\.js$/.test(f));

  const diffFile = path.join(attemptDir, `${slug}.diff`);
  fs.writeFileSync(diffFile, changes.diff);
  fs.writeFileSync(path.join(attemptDir, `${slug}.grade.txt`), tests.output);

  rmrf(workspace);

  return {
    agent: agent.id,
    scenario: scenario.id,
    rep,
    startedAt,
    passed: category === 'passed',
    category,
    durationMs: agentResult.durationMs,
    exitCode: agentResult.code,
    timedOut: agentResult.timedOut,
    tests: { total: tests.total, passed: tests.passed, failed: tests.failed, failures: tests.failures },
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      costUsd: usage.costUsd ?? null,
      turns: usage.turns ?? null,
    },
    changes: { files: changes.files, insertions: changes.insertions, deletions: changes.deletions },
    touchedTests,
    files: {
      log: path.relative(outDir, logFile).replace(/\\/g, '/'),
      diff: path.relative(outDir, diffFile).replace(/\\/g, '/'),
    },
  };
}

/**
 * Runs every (agent x scenario x repeat). Agents run in parallel (different providers),
 * each agent works through its own queue sequentially.
 */
async function runBenchmark({ agents, scenarios, repeat, timeoutSec, models, outDir, workRoot, parallel, onProgress }) {
  const hasGit = !!which('git');
  workRoot = workRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'faultline-'));
  fs.mkdirSync(workRoot, { recursive: true });
  const results = [];
  const queues = agents.map((agent) => {
    const jobs = [];
    for (let rep = 1; rep <= repeat; rep++) for (const scenario of scenarios) jobs.push({ agent, scenario, rep });
    return jobs;
  });
  const total = queues.reduce((n, q) => n + q.length, 0);
  let finished = 0;

  const worker = async (jobs) => {
    for (const job of jobs) {
      onProgress && onProgress({ type: 'start', ...job, finished, total });
      const r = await runAttempt({
        ...job,
        workRoot,
        outDir,
        timeoutSec,
        model: models[job.agent.id],
        hasGit,
      });
      results.push(r);
      finished++;
      onProgress && onProgress({ type: 'done', ...job, result: r, finished, total });
    }
  };

  const limit = Math.max(1, parallel || agents.length);
  const pending = [...queues];
  const running = new Set();
  while (pending.length || running.size) {
    while (pending.length && running.size < limit) {
      const p = worker(pending.shift()).finally(() => running.delete(p));
      running.add(p);
    }
    if (running.size) await Promise.race(running);
  }
  rmrf(workRoot);
  return { results, hasGit };
}

module.exports = { runBenchmark, runAttempt, parseTap, classify, CATEGORY_LABEL };
