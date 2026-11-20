'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readPart, writePart } = require('./scenarios');
const { run, runSync, which, rmrf } = require('./util');
const { PROMPT, runBuiltin } = require('./agents');

const GIT_ID = ['-c', 'user.email=bench@faultline.local', '-c', 'user.name=Faultline Bench', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const HIDDEN_DIR = '.faultline-hidden';

// Same environment the user has, minus variables that make a CLI think it is
// nested inside another agent session (e.g. running Faultline from Claude Code).
function agentEnv() {
  const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_SANDBOX.*|CODEX_THREAD_ID)$/i.test(k)) delete env[k];
  return env;
}

// The grader must print plain TAP even when Faultline itself runs under a test runner.
function graderEnv() {
  const env = { ...process.env, NODE_OPTIONS: '' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

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

/**
 * Grades in a fresh copy of the agent's result (without .git) inside a separate random temp folder,
 * away from the workspace, which makes it harder for a process the agent left running to find the
 * hidden tests. Local grading can never be fully secret; see suspiciousAccess() for detection.
 */
async function grade(scenario, workspace) {
  const gradeRoot = fs.mkdtempSync(path.join(path.dirname(path.dirname(workspace)), 'fg-'));
  const gradeDir = path.join(gradeRoot, 'w');
  fs.cpSync(workspace, gradeDir, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
  rmrf(path.join(gradeDir, HIDDEN_DIR)); // never trust anything the agent put at this name
  const written = writePart(readPart(scenario, 'hidden'), path.join(gradeDir, HIDDEN_DIR));
  const files = written.filter((f) => /\.test\.(c?js|mjs)$/.test(f)).map((f) => path.join(HIDDEN_DIR, f));
  const r = await run(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: gradeDir,
    timeoutMs: 120000,
    raw: true,
    env: graderEnv(),
  });
  const tap = parseTap(r.stdout);
  rmrf(gradeRoot);
  return { ...tap, timedOut: r.timedOut, output: (r.stdout + r.stderr).slice(-20000) };
}

function classify({ agentResult, tests, changes }) {
  if (tests.ran && tests.total > 0 && tests.failed === 0 && tests.passed === tests.total) return 'passed';
  if (agentResult.timedOut) return 'timeout';
  if (changes.files.length === 0) return agentResult.code !== 0 ? 'agent_error' : 'no_changes';
  if (!tests.ran || tests.timedOut) return 'broken_code';
  return 'tests_failed';
}

// Pulls the most useful error line out of an agent's output, so the user sees
// "model not supported" instead of just "crashed".
function errorHint(stdout, stderr) {
  const lines = `${stdout || ''}\n${stderr || ''}`.split(/\r?\n/).filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/error|failed|denied|not found|unauthori[sz]ed|quota|limit/i.test(l)) continue;
    const msgs = [...l.matchAll(/\\?"message\\?"\s*:\s*\\?"((?:[^"\\]|\\.)*?)\\?"/g)].map((m) => m[1]);
    const text = (msgs.length ? msgs[msgs.length - 1] : l).replace(/\\+"/g, '"').trim();
    if (text) return text.slice(0, 240);
  }
  return null;
}

// Flags attempts whose output shows the agent touching Faultline's own grading files.
function suspiciousAccess(text) {
  return /sealed\.gz|\.faultline-hidden|faultline-bench[\\/]+scenarios/i.test(text || '');
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
      env: agentEnv(),
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
    suspicious: suspiciousAccess(`${agentResult.stdout}\n${agentResult.stderr}`),
    errorHint: ['agent_error', 'no_changes', 'timeout'].includes(category) ? errorHint(agentResult.stdout, agentResult.stderr) : null,
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
  const base = workRoot || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  workRoot = fs.mkdtempSync(path.join(base, 'faultline-'));
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
  try {
    while (pending.length || running.size) {
      while (pending.length && running.size < limit) {
        const p = worker(pending.shift()).finally(() => running.delete(p));
        running.add(p);
      }
      if (running.size) await Promise.race(running);
    }
  } finally {
    await Promise.allSettled(running); // let other agents stop before deleting their folders
    rmrf(workRoot);
  }
  return { results, hasGit };
}

module.exports = { runBenchmark, runAttempt, parseTap, classify, errorHint, suspiciousAccess, CATEGORY_LABEL };
