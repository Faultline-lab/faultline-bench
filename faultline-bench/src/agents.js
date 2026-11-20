'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { which, run, resolveLaunch } = require('./util');

// Every agent gets the same short prompt. The real task lives in TASK.md inside
// the workspace, so nothing needs shell quoting and every agent sees identical text.
const PROMPT =
  'You are being evaluated by Faultline Bench. Read TASK.md in the current directory and complete the task ' +
  'by editing files in this directory. Work autonomously and do not ask questions. Stop when the task is done.';

/**
 * Agent adapters. `args(prompt, opts)` builds the non-interactive command line.
 * `parseUsage(stdout, stderr)` extracts whatever usage data the CLI reports.
 * Flags checked against: claude 2.1, codex 0.162, opencode 2.1, agy 1.5. Others are marked experimental.
 */
const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    bin: ['claude'],
    args: (p, o) => ['-p', p, '--output-format', 'json', '--dangerously-skip-permissions', ...(o.model ? ['--model', o.model] : [])],
    parseUsage: parseClaude,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: ['codex'],
    args: (p, o) => ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', ...(o.model ? ['-m', o.model] : []), p],
    parseUsage: parseCodex,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: ['gemini'],
    args: (p, o) => ['-p', p, '--yolo', '--output-format', 'json', ...(o.model ? ['-m', o.model] : [])],
    parseUsage: parseGemini,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: ['opencode'],
    // --standalone: private server that exits with the run, instead of the shared background service.
    args: (p, o) => ['run', '--standalone', '--auto', '--format', 'json', ...(o.model ? ['-m', o.model] : []), p],
    parseUsage: parseOpenCode,
  },
  {
    id: 'agy',
    name: 'Antigravity CLI',
    bin: ['agy', 'antigravity'],
    // agy ignores the process cwd unless the workspace is added explicitly.
    args: (p, o) => ['-p', p, '--output-format', 'json', '--add-dir', o.workspace, '--print-timeout', '30m', '--dangerously-skip-permissions', ...(o.model ? ['--model', o.model] : [])],
    parseUsage: parseAgy,
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    bin: ['qwen'],
    experimental: true,
    args: (p, o) => ['-p', p, '--yolo', ...(o.model ? ['-m', o.model] : [])],
    parseUsage: parseGeneric,
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    bin: ['cursor-agent'],
    experimental: true,
    args: (p, o) => ['-p', '--force', '--trust', '--output-format', 'json', ...(o.model ? ['--model', o.model] : []), p],
    parseUsage: parseGeneric,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    bin: ['copilot'],
    experimental: true,
    args: (p, o) => ['-p', p, '--allow-all-tools', ...(o.model ? ['--model', o.model] : [])],
    parseUsage: parseGeneric,
  },
  {
    id: 'amp',
    name: 'Amp',
    bin: ['amp'],
    experimental: true,
    args: (p) => ['-x', p, '--dangerously-allow-all'],
    parseUsage: parseGeneric,
  },
  {
    id: 'aider',
    name: 'Aider',
    bin: ['aider'],
    experimental: true,
    args: (p, o) => ['--yes-always', '--no-auto-commits', '--no-check-update', ...(o.model ? ['--model', o.model] : []), '--message', p],
    parseUsage: parseGeneric,
  },
  {
    id: 'goose',
    name: 'Goose',
    bin: ['goose'],
    experimental: true,
    args: (p) => ['run', '-t', p],
    parseUsage: parseGeneric,
  },
];

// Built-in pseudo agents for testing the harness itself (never auto-selected).
const BUILTIN = [
  { id: 'oracle', name: 'Oracle (reference solution)', builtin: true },
  { id: 'noop', name: 'No-op (changes nothing)', builtin: true },
];

// ---------- usage parsers ----------
function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function jsonLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('{')) {
      const j = tryJson(t);
      if (j) out.push(j);
    }
  }
  return out;
}

function parseClaude(stdout) {
  const j = tryJson(stdout.trim()) || jsonLines(stdout).reverse().find((x) => x.type === 'result');
  if (!j) return parseGeneric(stdout);
  const u = j.usage || {};
  const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return {
    inputTokens: input || null,
    outputTokens: u.output_tokens || null,
    costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null,
    turns: j.num_turns || null,
    agentReportedError: j.is_error === true,
  };
}

function parseCodex(stdout) {
  let input = 0;
  let output = 0;
  let turns = 0;
  for (const ev of jsonLines(stdout)) {
    const u = ev.usage || (ev.msg && ev.msg.info && ev.msg.info.last_token_usage);
    if (ev.type === 'turn.completed' && u) {
      turns++;
      input += u.input_tokens || 0;
      output += u.output_tokens || 0; // already includes reasoning tokens
    }
  }
  if (!turns) return parseGeneric(stdout);
  return { inputTokens: input || null, outputTokens: output || null, costUsd: null, turns };
}

function parseGemini(stdout) {
  const j = tryJson(stdout.trim());
  if (!j || !j.stats) return parseGeneric(stdout);
  let input = 0;
  let output = 0;
  for (const m of Object.values((j.stats && j.stats.models) || {})) {
    const t = m.tokens || {};
    input += t.prompt || t.input || 0;
    output += (t.candidates || t.output || 0) + (t.thoughts || 0);
  }
  return { inputTokens: input || null, outputTokens: output || null, costUsd: null, turns: null };
}

// opencode run --format json: usage lives in step_finish events, summed across steps.
function parseOpenCode(stdout) {
  let input = 0;
  let output = 0;
  let cost = 0;
  let steps = 0;
  let sawCost = false;
  for (const ev of jsonLines(stdout)) {
    if (ev.type !== 'step_finish' || !ev.part) continue;
    steps++;
    const t = ev.part.tokens || {};
    input += (t.input || 0) + ((t.cache && t.cache.read) || 0);
    output += t.output || 0;
    if (typeof ev.part.cost === 'number') {
      cost += ev.part.cost;
      sawCost = true;
    }
  }
  if (!steps) return parseGeneric(stdout);
  return { inputTokens: input || null, outputTokens: output || null, costUsd: sawCost ? cost : null, turns: steps };
}

// agy -p --output-format json prints one result object with a usage block.
function parseAgy(stdout) {
  const objs = jsonLines(stdout);
  const whole = tryJson(stdout.trim());
  if (whole) objs.push(whole);
  const r = objs.reverse().find((o) => o.usage || o.conversation_id);
  if (!r || !r.usage) return parseGeneric(stdout);
  const u = r.usage;
  return {
    inputTokens: (u.input_tokens || 0) + (u.cache_read_tokens || 0) || null,
    outputTokens: u.output_tokens || null,
    costUsd: null,
    turns: r.num_turns || null,
    agentReportedError: r.status && r.status !== 'SUCCESS',
  };
}

// Walks any JSON the CLI printed and sums token/cost fields it recognises.
function parseGeneric(stdout) {
  let input = 0;
  let output = 0;
  let cost = 0;
  let sawCost = false;
  const docs = jsonLines(stdout);
  const whole = tryJson(stdout.trim());
  if (whole) docs.push(whole);
  const visit = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o)) return o.forEach((x) => visit(x, depth + 1));
    const t = o.tokens && typeof o.tokens === 'object' ? o.tokens : null;
    if (t && (typeof t.input === 'number' || typeof t.output === 'number')) {
      input += (t.input || 0) + ((t.cache && t.cache.read) || 0);
      output += (t.output || 0) + (t.reasoning || 0);
    } else if (typeof o.input_tokens === 'number' || typeof o.output_tokens === 'number') {
      input += o.input_tokens || 0;
      output += o.output_tokens || 0;
    }
    for (const k of ['cost', 'total_cost_usd', 'cost_usd']) {
      if (typeof o[k] === 'number') {
        cost += o[k];
        sawCost = true;
      }
    }
    for (const [k, v] of Object.entries(o)) if (k !== 'tokens' && v && typeof v === 'object') visit(v, depth + 1);
  };
  docs.forEach((d) => visit(d, 0));
  return { inputTokens: input || null, outputTokens: output || null, costUsd: sawCost ? cost : null, turns: null };
}

// ---------- custom agents ----------
// --agent-cmd "name=mycli -p {prompt} --yes"  (whitespace-separated; {prompt} is replaced)
function parseCustomAgent(spec) {
  const eq = spec.indexOf('=');
  if (eq < 1) throw new Error(`--agent-cmd must look like "name=command args {prompt}", got: ${spec}`);
  const id = spec.slice(0, eq).trim();
  const parts = spec.slice(eq + 1).trim().split(/\s+/);
  if (!parts[0]) throw new Error(`--agent-cmd "${spec}" has no command`);
  const [bin, ...rest] = parts;
  if (!rest.some((a) => a.includes('{prompt}'))) rest.push('{prompt}');
  return {
    id,
    name: `${id} (custom)`,
    bin: [bin],
    custom: true,
    args: (p) => rest.map((a) => a.split('{prompt}').join(p)),
    parseUsage: parseGeneric,
  };
}

// ---------- detection ----------
// npm-installed CLIs: read the version from the package on disk instead of launching the CLI.
function versionFromPackage(exe) {
  const launch = resolveLaunch(exe, []);
  const target = launch.shell ? null : launch.args[0] && launch.command === process.execPath ? launch.args[0] : launch.command;
  if (!target || !/node_modules/.test(target)) return null;
  let dir = path.dirname(target);
  for (let i = 0; i < 6 && /node_modules/.test(dir); i++) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        const v = JSON.parse(fs.readFileSync(pj, 'utf8')).version;
        if (v) return v;
      } catch {
        /* keep looking */
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

async function probeVersion(exe) {
  const fromPkg = versionFromPackage(exe);
  if (fromPkg) return fromPkg;
  // Some CLIs are slow to start or never answer --version; don't make the user wait for them.
  const r = await Promise.race([
    run(exe, ['--version'], { timeoutMs: 8000 }),
    new Promise((res) => setTimeout(() => res({ timedOut: true, code: null }), 6000).unref()),
  ]);
  if (r.timedOut || r.code !== 0) return null;
  const line = (r.stdout || r.stderr).split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const m = line.match(/\d+\.\d+(\.\d+)?([-.\w]*)?/);
  return m ? m[0] : line.trim().slice(0, 40);
}

/**
 * Finds agents on PATH instantly. Versions are probed in the background:
 * `versionReady` resolves once each agent's `version` field is filled in (or given up on).
 */
function detectAgents(customs = []) {
  const all = [...AGENTS, ...customs].map((a) => {
    let exe = null;
    for (const b of a.bin) {
      exe = which(b);
      if (exe) break;
    }
    return { ...a, exe, version: null, installed: !!exe };
  });
  const versionReady = Promise.all(
    all.filter((a) => a.installed).map((a) => probeVersion(a.exe).then((v) => (a.version = v), () => null))
  );
  return { agents: all, versionReady };
}

function knownAgentIds() {
  return [...AGENTS.map((a) => a.id), ...BUILTIN.map((a) => a.id)];
}

function findBuiltin(id) {
  return BUILTIN.find((a) => a.id === id) || null;
}

// Applies a built-in pseudo agent to a workspace.
function runBuiltin(agent, scenario, workspace) {
  const started = Date.now();
  if (agent.id === 'oracle') {
    const sol = path.join(scenario.dir, 'solution');
    if (fs.existsSync(sol)) fs.cpSync(sol, workspace, { recursive: true });
  }
  return { code: 0, stdout: '', stderr: '', timedOut: false, durationMs: Date.now() - started };
}

module.exports = {
  PROMPT,
  AGENTS,
  BUILTIN,
  detectAgents,
  parseCustomAgent,
  knownAgentIds,
  findBuiltin,
  runBuiltin,
  parsers: { parseClaude, parseCodex, parseGemini, parseOpenCode, parseAgy, parseGeneric },
};
