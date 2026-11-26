'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const isWin = process.platform === 'win32';

// ---------- terminal colors (respects NO_COLOR / non-TTY) ----------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
};

// ---------- finding executables on PATH ----------
const dirCache = new Map();
function listDir(dir) {
  if (!dirCache.has(dir)) {
    let names = null;
    try {
      names = new Map(fs.readdirSync(dir).map((n) => [isWin ? n.toLowerCase() : n, n]));
    } catch {
      /* missing or unreadable PATH entry */
    }
    dirCache.set(dir, names);
  }
  return dirCache.get(dir);
}

// Reads each PATH folder once, so looking up many CLIs stays fast even with a long PATH.
function which(cmd) {
  if (!cmd) return null;
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : null;
  const exts = isWin
    ? [...new Set(['.exe', '.cmd', '.bat', '.com', ...(process.env.PATHEXT || '').toLowerCase().split(';').filter(Boolean)])]
    : [''];
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter);
  for (const raw of dirs) {
    const dir = raw.replace(/^"|"$/g, '');
    if (!dir) continue;
    const names = listDir(dir);
    if (!names) continue;
    for (const ext of exts) {
      const key = isWin ? (cmd + ext).toLowerCase() : cmd + ext;
      if (names.has(key)) {
        const p = path.join(dir, names.get(key));
        try {
          if (fs.statSync(p).isFile()) return p;
        } catch {
          /* broken link */
        }
      }
    }
  }
  return null;
}

// On Windows, npm installs CLIs as .cmd shims. Node refuses to spawn .cmd files
// without a shell, and shells mangle arguments. We read the shim and launch the
// real target directly instead.
function resolveLaunch(exePath, args) {
  if (!isWin || !/\.(cmd|bat)$/i.test(exePath)) return { command: exePath, args, shell: false };
  let text = '';
  try {
    text = fs.readFileSync(exePath, 'utf8');
  } catch {
    /* fall through */
  }
  const dir = path.dirname(exePath);
  const matches = [...text.matchAll(/"%~?dp0%?\\?([^"]+?)"\s+%\*/g)];
  if (matches.length) {
    const target = path.join(dir, matches[matches.length - 1][1]);
    if (fs.existsSync(target)) {
      if (/\.exe$/i.test(target)) return { command: target, args, shell: false };
      return { command: process.execPath, args: [target, ...args], shell: false };
    }
  }
  // Last resort: go through cmd.exe with quoted args.
  const quoted = args.map((a) => (/[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a));
  return { command: [`"${exePath}"`, ...quoted].join(' '), args: [], shell: true };
}

function killTree(child, sync = false) {
  if (!child || child.exitCode !== null) return;
  try {
    // async by default: taskkill can take seconds and must not block other running agents.
    // sync when exiting, so the tree is gone before we delete its working dir.
    if (isWin) (sync ? spawnSync : spawn)('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

// Children started by run() that have not exited yet, so Ctrl+C can kill them.
const live = new Set();
function killAll() {
  for (const child of live) killTree(child, true);
}

/**
 * Run a command, capture output, enforce a timeout.
 * Resolves { code, stdout, stderr, timedOut, durationMs, error }.
 */
function run(command, args, opts = {}) {
  const { cwd, env, timeoutMs = 0, logFile, maxBuffer = 8 * 1024 * 1024, onLine } = opts;
  return new Promise((resolve) => {
    const started = Date.now();
    const launch = opts.raw ? { command, args, shell: false } : resolveLaunch(command, args);
    let child;
    try {
      child = spawn(launch.command, launch.args, {
        cwd,
        env: env || process.env,
        shell: launch.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !isWin,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error), timedOut: false, durationMs: 0, error });
      return;
    }
    live.add(child);
    const log = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let partial = '';
    const take = (which) => (buf) => {
      const s = buf.toString('utf8');
      if (log) log.write(s);
      if (which === 'out' && stdout.length < maxBuffer) stdout += s;
      if (which === 'err' && stderr.length < maxBuffer) stderr += s;
      if (onLine) {
        partial += s;
        const lines = partial.split(/\r?\n/);
        partial = lines.pop();
        for (const l of lines) onLine(l);
      }
    };
    child.stdout.on('data', take('out'));
    child.stderr.on('data', take('err'));
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, timeoutMs)
        : null;
    let done = false;
    const finish = (code, error) => {
      if (done) return;
      done = true;
      live.delete(child);
      if (timer) clearTimeout(timer);
      const result = { code, stdout, stderr, timedOut, durationMs: Date.now() - started, error };
      if (log) log.end(() => resolve(result));
      else resolve(result);
    };
    child.on('error', (error) => finish(-1, error));
    child.on('close', (code) => finish(code === null ? -1 : code));
    // Some CLIs (e.g. `opencode run`) leave a background child holding stdout open
    // after the main process exits, so 'close' never fires. Drain briefly, then stop waiting.
    child.on('exit', (code) => {
      setTimeout(() => {
        if (done) return;
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code === null ? -1 : code);
      }, 3000).unref();
    });
  });
}

function runSync(command, args, opts = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...opts });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

// ---------- misc ----------
function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function fmtTokens(n) {
  if (!n) return '-';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd) {
  if (usd == null) return '-';
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

function timestampId(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    /* best effort */
  }
}

function openInBrowser(file) {
  try {
    if (isWin) spawn('cmd', ['/c', 'start', '""', file], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [file], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [file], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* user can open it manually */
  }
}

module.exports = {
  isWin,
  c,
  which,
  resolveLaunch,
  run,
  runSync,
  killTree,
  killAll,
  fmtDuration,
  fmtTokens,
  fmtCost,
  timestampId,
  rmrf,
  openInBrowser,
};
