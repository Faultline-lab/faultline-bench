'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { c, fmtDuration, fmtCost, timestampId, openInBrowser } = require('./util');
const { detectAgents, parseCustomAgent, findBuiltin, knownAgentIds, AGENTS } = require('./agents');
const { loadScenarios, selectScenarios } = require('./scenarios');
const { runBenchmark, CATEGORY_LABEL } = require('./runner');
const { summarize, printSummary, writeReports } = require('./report');

const VERSION = require('../package.json').version;

const HELP = `
${c.bold('Faultline Bench')} ${VERSION} · find the best AI coding agent for your codebase

${c.bold('Usage')}
  faultline                     Interactive: detect agents, pick, run, open report
  faultline run [options]       Run the benchmark
  faultline detect              List coding-agent CLIs installed on this machine
  faultline list                List built-in scenarios

${c.bold('Run options')}
  --agents <ids>         Comma list, e.g. claude,codex  ("all" = every installed agent)
  --suite <name>         quick (3 tasks, default) or full (6 tasks)
  --scenarios <ids>      Run specific scenarios instead of a suite
  --repeat <n>           Run each task n times to measure reliability (default 1)
  --timeout <sec>        Per-task time limit (default: per scenario, 7-9 min)
  --model <agent=model>  Pick a model, e.g. --model claude=sonnet (repeatable)
  --agent-cmd <spec>     Add any CLI: "name=mycli --yes -p {prompt}" (repeatable)
  --parallel <n>         Agents to run at the same time (default: all selected)
  --out <dir>            Where to write the report (default ./faultline-results/<run>)
  -y, --yes              Skip confirmation prompts
  --no-open              Do not open the HTML report when done

${c.bold('Examples')}
  faultline
  faultline run --agents claude,codex --suite full --repeat 3
  faultline run --agents oracle            (dry run: checks the harness, no AI used)

Agents run in a throwaway copy of each scenario with auto-approve enabled.
No account, no telemetry, nothing uploaded. Your own AI subscriptions/credits are used.
`;

// ---------- argument parsing ----------
function parseArgs(argv) {
  const opts = { _: [], model: [], agentCmd: [], open: true, yes: false };
  const takes = new Set(['agents', 'suite', 'scenarios', 'repeat', 'timeout', 'model', 'agent-cmd', 'parallel', 'out', 'workdir']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '--no-open') opts.open = false;
    else if (a.startsWith('--')) {
      let [key, val] = a.slice(2).split(/=(.*)/s);
      if (!takes.has(key)) throw new Error(`Unknown option --${key}. Run "faultline --help".`);
      if (val === undefined) {
        val = argv[++i];
        if (val === undefined) throw new Error(`--${key} needs a value`);
      }
      if (key === 'model') opts.model.push(val);
      else if (key === 'agent-cmd') opts.agentCmd.push(val);
      else opts[key] = val;
    } else opts._.push(a);
  }
  return opts;
}

function intOpt(v, name, min, max) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be a whole number from ${min} to ${max}`);
  return n;
}

// ---------- prompts ----------
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => (rl.close(), resolve(ans.trim()))));
}

const interactive = () => process.stdin.isTTY && process.stdout.isTTY;

// ---------- commands ----------
function banner() {
  console.log('');
  console.log(`  ${c.bold('FAULTLINE')} ${c.bold(c.magenta('BENCH'))} ${c.dim(VERSION)}  ${c.dim('· find the best AI coding agent for your codebase')}`);
  console.log('');
}

function printDetected(detected) {
  for (const a of detected) {
    if (a.installed) console.log(`  ${c.green('✓')} ${a.name.padEnd(20)} ${c.dim(a.version || '')}${a.experimental ? c.dim('  (experimental)') : ''}`);
  }
  const missing = detected.filter((a) => !a.installed).map((a) => a.name);
  if (missing.length) console.log(c.dim(`  · not found: ${missing.join(', ')}`));
}

async function cmdDetect(opts) {
  banner();
  console.log(c.dim('  Looking for coding-agent CLIs on your PATH…\n'));
  const { agents, versionReady } = detectAgents(opts.agentCmd.map(parseCustomAgent));
  await versionReady;
  printDetected(agents);
  console.log('');
  return 0;
}

function cmdList() {
  banner();
  const all = loadScenarios();
  for (const s of all) {
    console.log(`  ${c.bold(s.id.padEnd(24))} ${s.title}`);
    console.log(c.dim(`  ${''.padEnd(24)} ${s.category} · ${s.difficulty} · suites: ${s.suites.join(', ')}`));
  }
  console.log('');
  return 0;
}

async function chooseAgents(detected, opts) {
  const installed = detected.filter((a) => a.installed);
  if (opts.agents) {
    const ids = opts.agents.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (ids.includes('all')) {
      if (!installed.length) throw new Error('No agent CLIs found. Run "faultline detect".');
      return installed;
    }
    return ids.map((id) => {
      const builtin = findBuiltin(id);
      if (builtin) return { ...builtin, version: 'built-in' };
      const a = detected.find((x) => x.id === id);
      if (!a) throw new Error(`Unknown agent "${id}". Known: ${knownAgentIds().join(', ')} (or add one with --agent-cmd)`);
      if (!a.installed) throw new Error(`${a.name} ("${a.bin[0]}") is not installed or not on your PATH.`);
      return a;
    });
  }

  if (!installed.length) {
    console.log(c.yellow('  No coding-agent CLIs found on your PATH.'));
    console.log(`  Install one, e.g. ${c.bold('npm i -g @openai/codex')} or ${c.bold('npm i -g @google/gemini-cli')}, then run faultline again.`);
    console.log(`  Or try the harness without AI: ${c.bold('faultline run --agents oracle')}\n`);
    return null;
  }
  if (!interactive() || opts.yes) return installed;

  console.log('');
  installed.forEach((a, i) => console.log(`  ${c.bold(`[${i + 1}]`)} ${a.name} ${c.dim(a.version || '')}`));
  const ans = await ask(`\n  Which agents? ${c.dim('(e.g. 1,2 · Enter = all)')} `);
  if (!ans || ans.toLowerCase() === 'a' || ans.toLowerCase() === 'all') return installed;
  const picked = [];
  for (const part of ans.split(/[,\s]+/).filter(Boolean)) {
    const n = Number(part);
    const a = Number.isInteger(n) ? installed[n - 1] : installed.find((x) => x.id === part.toLowerCase());
    if (!a) throw new Error(`"${part}" is not in the list`);
    if (!picked.includes(a)) picked.push(a);
  }
  return picked;
}

async function chooseSuite(opts) {
  if (opts.suite || opts.scenarios || !interactive() || opts.yes) return opts.suite || 'quick';
  console.log('');
  console.log(`  ${c.bold('[1]')} quick  ${c.dim('3 tasks · a few minutes per agent')}`);
  console.log(`  ${c.bold('[2]')} full   ${c.dim('6 tasks · bug fixes, features, multi-file, edge cases')}`);
  const ans = await ask(`\n  Which suite? ${c.dim('(Enter = quick)')} `);
  return ans === '2' || ans.toLowerCase() === 'full' ? 'full' : 'quick';
}

async function cmdRun(opts) {
  banner();
  const customs = opts.agentCmd.map(parseCustomAgent);
  const models = {};
  for (const m of opts.model) {
    const [id, model] = m.split(/=(.*)/s);
    if (!id || !model) throw new Error(`--model must look like agent=model, got "${m}"`);
    models[id.trim()] = model.trim();
  }
  const repeat = intOpt(opts.repeat, 'repeat', 1, 20) || 1;
  const timeoutSec = intOpt(opts.timeout, 'timeout', 10, 7200);
  const parallel = intOpt(opts.parallel, 'parallel', 1, 16);

  const { agents: detected, versionReady } = detectAgents(customs);
  printDetected(detected);

  const agents = await chooseAgents(detected, opts);
  if (!agents) return 1;
  if (!agents.length) throw new Error('No agents selected.');

  const suite = await chooseSuite(opts);
  const scenarios = selectScenarios(loadScenarios(), {
    suite,
    ids: opts.scenarios ? opts.scenarios.split(',').map((s) => s.trim()).filter(Boolean) : null,
  });

  const runs = agents.length * scenarios.length * repeat;
  const realAgents = agents.filter((a) => !a.builtin);
  console.log('');
  console.log(`  ${c.bold('Plan')}  ${agents.map((a) => a.name).join(', ')}`);
  console.log(`        ${scenarios.length} scenarios × ${repeat} run${repeat > 1 ? 's' : ''} = ${runs} attempts${realAgents.length ? c.dim(`  (roughly ${scenarios.length * repeat}–${scenarios.length * repeat * 3} min; agents run in parallel)`) : ''}`);
  if (realAgents.length) {
    console.log('');
    console.log(c.yellow('  ⚠ Agents run with auto-approve (e.g. --dangerously-skip-permissions) inside a temporary'));
    console.log(c.yellow('    copy of each scenario. They can still run commands on this machine. This uses your'));
    console.log(c.yellow('    own AI subscription or API credits.'));
    if (interactive() && !opts.yes) {
      const ans = await ask(`\n  Start? ${c.dim('(Y/n)')} `);
      if (ans && !/^y(es)?$/i.test(ans)) {
        console.log('  Cancelled.\n');
        return 1;
      }
    }
  }

  await versionReady; // usually finished while the user was answering prompts
  const runId = timestampId();
  const outDir = path.resolve(opts.out || path.join(process.cwd(), 'faultline-results', runId));
  fs.mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const nameOf = (id) => (agents.find((a) => a.id === id) || {}).name || id;
  const nameWidth = Math.max(...agents.map((a) => a.name.length));

  console.log('');
  const inFlight = new Map();
  const heartbeat = setInterval(() => {
    if (!inFlight.size) return;
    const parts = [...inFlight.entries()].map(([k, t]) => `${k} ${fmtDuration(Date.now() - t)}`);
    console.log(c.dim(`  … still working: ${parts.join(' · ')}`));
  }, 60000);
  heartbeat.unref();

  const { results } = await runBenchmark({
    agents,
    scenarios,
    repeat,
    timeoutSec,
    models,
    outDir,
    workRoot: opts.workdir || process.env.FAULTLINE_WORKDIR ? path.resolve(opts.workdir || process.env.FAULTLINE_WORKDIR, `faultline-${runId}`) : undefined,
    parallel,
    onProgress: (ev) => {
      const key = `${ev.agent.name} · ${ev.scenario.id}${repeat > 1 ? ` #${ev.rep}` : ''}`;
      if (ev.type === 'start') {
        inFlight.set(key, Date.now());
        return;
      }
      inFlight.delete(key);
      const r = ev.result;
      const mark = r.passed ? c.green('✓') : c.red('✗');
      const why = r.passed ? '' : c.dim(`  ${CATEGORY_LABEL[r.category]}`);
      const cost = r.usage.costUsd != null ? c.dim(`  ${fmtCost(r.usage.costUsd)}`) : '';
      console.log(
        `  ${mark} ${nameOf(r.agent).padEnd(nameWidth)}  ${(r.scenario + (repeat > 1 ? ` #${r.rep}` : '')).padEnd(26)} ${String(`${r.tests.passed}/${r.tests.total}`).padStart(5)} tests  ${fmtDuration(r.durationMs).padStart(6)}${cost}${why}  ${c.dim(`[${ev.finished}/${ev.total}]`)}`
      );
    },
  });
  clearInterval(heartbeat);

  const summary = summarize(results, agents, scenarios, repeat);
  const report = {
    tool: 'faultline-bench',
    version: VERSION,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: { os: `${os.type()} ${os.release()} ${os.arch()}`, node: process.versions.node },
    config: { suite: opts.scenarios ? 'custom' : suite, repeat, timeoutSec: timeoutSec || null, models },
    agents: agents.map((a) => ({ id: a.id, name: a.name, version: a.version || null })),
    scenarios: scenarios.map((s) => ({ id: s.id, title: s.title, category: s.category, difficulty: s.difficulty })),
    summary,
    attempts: results,
  };
  const { htmlPath, jsonPath } = writeReports(report, outDir);
  printSummary(report);
  console.log('');
  console.log(`  ${c.bold('Report')}  ${htmlPath}`);
  console.log(`  ${c.dim('Data')}    ${jsonPath}`);
  console.log('');
  if (opts.open && interactive()) openInBrowser(htmlPath);
  return 0;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.version) {
    console.log(VERSION);
    return 0;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const cmd = opts._[0];
  if (!cmd) return cmdRun(opts);
  if (cmd === 'run') return cmdRun(opts);
  if (cmd === 'detect') return cmdDetect(opts);
  if (cmd === 'list') return cmdList();
  if (cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  throw new Error(`Unknown command "${cmd}". Run "faultline --help".`);
}

module.exports = { main, parseArgs, AGENTS };
