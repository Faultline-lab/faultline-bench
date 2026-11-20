'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { c, fmtDuration, fmtTokens, fmtCost } = require('./util');
const { CATEGORY_LABEL } = require('./runner');

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function summarize(results, agents, scenarios, repeat) {
  const rows = agents.map((agent) => {
    const mine = results.filter((r) => r.agent === agent.id);
    const passed = mine.filter((r) => r.passed).length;
    const perScenario = scenarios.map((s) => {
      const reps = mine.filter((r) => r.scenario === s.id);
      const k = reps.filter((r) => r.passed).length;
      return { scenario: s.id, passed: k, runs: reps.length };
    });
    const withUsage = mine.filter((r) => r.usage.inputTokens || r.usage.outputTokens);
    const withCost = mine.filter((r) => r.usage.costUsd != null);
    const failures = {};
    for (const r of mine) if (!r.passed) failures[r.category] = (failures[r.category] || 0) + 1;
    return {
      agent: agent.id,
      name: agent.name,
      version: agent.version || null,
      attempts: mine.length,
      passed,
      solveRate: mine.length ? passed / mine.length : 0,
      testPassRate: mean(mine.map((r) => (r.tests.total ? r.tests.passed / r.tests.total : 0))),
      medianDurationMs: median(mine.map((r) => r.durationMs)),
      totalDurationMs: mine.reduce((a, r) => a + r.durationMs, 0),
      inputTokens: withUsage.length ? withUsage.reduce((a, r) => a + (r.usage.inputTokens || 0), 0) : null,
      outputTokens: withUsage.length ? withUsage.reduce((a, r) => a + (r.usage.outputTokens || 0), 0) : null,
      costUsd: withCost.length ? withCost.reduce((a, r) => a + r.usage.costUsd, 0) : null,
      // Reliability: share of scenarios where every repeat agreed (all pass or all fail).
      consistency: repeat > 1 ? mean(perScenario.map((p) => (p.passed === 0 || p.passed === p.runs ? 1 : 0))) : null,
      // pass^k: share of scenarios solved in EVERY repeat.
      passAllRate: mean(perScenario.map((p) => (p.runs && p.passed === p.runs ? 1 : 0))),
      perScenario,
      failures,
    };
  });
  rows.sort((a, b) => b.solveRate - a.solveRate || b.testPassRate - a.testPassRate || a.medianDurationMs - b.medianDurationMs);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ---------- console ----------
function pad(s, n, right = false) {
  const raw = String(s);
  // eslint-disable-next-line no-control-regex
  const visible = raw.replace(/\x1b\[[0-9;]*m/g, '').length;
  const fill = ' '.repeat(Math.max(0, n - visible));
  return right ? fill + raw : raw + fill;
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

function printSummary(report) {
  const { summary, config } = report;
  console.log('');
  console.log(c.bold('  Results'));
  console.log('');
  const head = ['#', 'Agent', 'Solved', 'Tests', 'Median time', 'Tokens', 'Cost'];
  if (config.repeat > 1) head.push('Consistent');
  const nameW = Math.max(6, ...summary.map((r) => r.name.length));
  const widths = [3, nameW, 12, 7, 12, 9, 9, 11];
  console.log('  ' + head.map((h, i) => pad(c.dim(h), widths[i], i > 1)).join(' '));
  for (const r of summary) {
    const color = r.solveRate >= 0.8 ? c.green : r.solveRate >= 0.5 ? c.yellow : c.red;
    const cells = [
      String(r.rank),
      r.name,
      color(`${r.passed}/${r.attempts} ${pct(r.solveRate)}`),
      pct(r.testPassRate),
      fmtDuration(r.medianDurationMs),
      fmtTokens((r.inputTokens || 0) + (r.outputTokens || 0)),
      fmtCost(r.costUsd),
    ];
    if (config.repeat > 1) cells.push(pct(r.consistency));
    console.log('  ' + cells.map((v, i) => pad(v, widths[i], i > 1)).join(' '));
  }
  console.log('');
  console.log(c.dim('  Solved = all hidden tests pass. Tests = average share of hidden tests passed.'));
  console.log(c.dim('  Tokens and cost are shown only when the agent CLI reports them.'));
}

// ---------- html ----------
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function readTail(file, max) {
  try {
    const s = fs.readFileSync(file, 'utf8');
    return s.length > max ? `… (${s.length - max} earlier characters omitted)\n` + s.slice(-max) : s;
  } catch {
    return '';
  }
}

function readHead(file, max) {
  try {
    const s = fs.readFileSync(file, 'utf8');
    return s.length > max ? s.slice(0, max) + `\n… (diff truncated, ${s.length - max} more characters in ${path.basename(file)})` : s;
  } catch {
    return '';
  }
}

function diffHtml(diff) {
  if (!diff.trim()) return '<p class="muted">No changes.</p>';
  return (
    '<pre class="diff">' +
    diff
      .split('\n')
      .map((l) => {
        const cls = l.startsWith('+++') || l.startsWith('---') ? 'f' : l.startsWith('+') ? 'a' : l.startsWith('-') ? 'd' : l.startsWith('@@') ? 'h' : '';
        return cls ? `<span class="${cls}">${esc(l)}</span>` : esc(l);
      })
      .join('\n') +
    '</pre>'
  );
}

function buildHtml(report, outDir) {
  const { summary, attempts, scenarios, config, environment } = report;
  const best = summary[0];
  const bar = (x) => `<div class="bar"><span style="width:${Math.round(x * 100)}%"></span></div>`;

  const leaderboard = summary
    .map(
      (r) => `<tr>
  <td class="rank">${r.rank}</td>
  <td><strong>${esc(r.name)}</strong><div class="muted">${esc(r.version || '')}</div></td>
  <td><div class="score">${Math.round(r.solveRate * 100)}%</div>${bar(r.solveRate)}<div class="muted">${r.passed}/${r.attempts} solved</div></td>
  <td>${Math.round(r.testPassRate * 100)}%</td>
  <td>${fmtDuration(r.medianDurationMs)}</td>
  <td>${fmtTokens((r.inputTokens || 0) + (r.outputTokens || 0))}</td>
  <td>${fmtCost(r.costUsd)}</td>
  ${config.repeat > 1 ? `<td>${Math.round(r.consistency * 100)}%</td><td>${Math.round(r.passAllRate * 100)}%</td>` : ''}
  <td>${Object.entries(r.failures)
    .map(([k, n]) => `<span class="tag ${k}">${esc(CATEGORY_LABEL[k] || k)} ×${n}</span>`)
    .join(' ') || '<span class="muted">none</span>'}</td>
</tr>`
    )
    .join('\n');

  const matrixHead = summary.map((r) => `<th>${esc(r.name)}</th>`).join('');
  const matrixRows = scenarios
    .map((s) => {
      const cells = summary
        .map((r) => {
          const reps = attempts.filter((a) => a.agent === r.agent && a.scenario === s.id);
          const k = reps.filter((a) => a.passed).length;
          const cls = k === reps.length ? 'ok' : k === 0 ? 'bad' : 'mixed';
          const tests = reps.map((a) => `${a.tests.passed}/${a.tests.total}`).join(', ');
          return `<td class="cell ${cls}"><a href="#${esc(r.agent)}-${esc(s.id)}">${k === reps.length ? '✓' : k === 0 ? '✗' : '◐'} ${k}/${reps.length}</a><div class="muted">tests ${tests} · ${fmtDuration(median(reps.map((a) => a.durationMs)))}</div></td>`;
        })
        .join('');
      return `<tr><td><strong>${esc(s.title)}</strong><div class="muted">${esc(s.category)} · ${esc(s.difficulty)}</div></td>${cells}</tr>`;
    })
    .join('\n');

  const details = attempts
    .slice()
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.scenario.localeCompare(b.scenario) || a.rep - b.rep)
    .map((a) => {
      const agentName = (summary.find((r) => r.agent === a.agent) || {}).name || a.agent;
      const s = scenarios.find((x) => x.id === a.scenario) || { title: a.scenario };
      const diff = readHead(path.join(outDir, a.files.diff), 60000);
      const log = readTail(path.join(outDir, a.files.log), 6000);
      return `<details id="${esc(a.agent)}-${esc(a.scenario)}" class="attempt">
<summary><span class="tag ${a.category}">${a.passed ? '✓ Passed' : esc(CATEGORY_LABEL[a.category])}</span> <strong>${esc(agentName)}</strong> · ${esc(s.title)} · run ${a.rep}
<span class="muted">· tests ${a.tests.passed}/${a.tests.total} · ${fmtDuration(a.durationMs)} · ${a.changes.files.length} files (+${a.changes.insertions} −${a.changes.deletions})${a.usage.costUsd != null ? ' · ' + fmtCost(a.usage.costUsd) : ''}</span></summary>
<div class="body">
${a.touchedTests.length ? `<p class="warn">Note: the agent edited test files (${esc(a.touchedTests.join(', '))}). Grading uses separate hidden tests, so this does not affect the score.</p>` : ''}
${a.errorHint ? `<p class="warn">Agent error: ${esc(a.errorHint)}</p>` : ''}
${a.tests.failures.length ? `<h4>Failing hidden tests</h4><ul>${a.tests.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
<h4>Code changes</h4>${diffHtml(diff)}
<h4>Agent output (tail)</h4><pre class="log">${esc(log) || '<span class="muted">No output.</span>'}</pre>
<p class="muted">Full log: ${esc(a.files.log)} · exit code ${a.exitCode}${a.timedOut ? ' · timed out' : ''}</p>
</div></details>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Faultline Bench report · ${esc(report.runId)}</title>
<style>
:root{--bg:#0d1117;--panel:#151b23;--line:#262f3a;--text:#e6edf3;--muted:#8b98a7;--accent:#ff6b35;--ok:#3fb950;--bad:#f85149;--mid:#d29922}
@media (prefers-color-scheme: light){:root{--bg:#f7f8fa;--panel:#fff;--line:#e3e7ec;--text:#1b2330;--muted:#5d6b7a;--accent:#e4572e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 20px 64px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:20px}
.brand{font-weight:800;letter-spacing:.02em;font-size:22px}.brand span{color:var(--accent)}
.muted{color:var(--muted);font-size:13px}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:24px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
.card .big{font-size:26px;font-weight:700}
h2{margin:36px 0 12px;font-size:18px}
main .scroll{overflow-x:auto;border-radius:10px}table{width:100%;min-width:640px;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
td.rank{font-weight:700;color:var(--accent);width:32px}
.score{font-weight:700;font-size:18px}
.bar{height:6px;background:var(--line);border-radius:3px;margin:4px 0;min-width:90px}.bar span{display:block;height:100%;background:var(--accent);border-radius:3px}
.cell a{color:inherit;text-decoration:none;font-weight:700}.cell.ok a{color:var(--ok)}.cell.bad a{color:var(--bad)}.cell.mixed a{color:var(--mid)}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);margin:1px 0;white-space:nowrap}
.tag.passed{color:var(--ok);border-color:var(--ok)}.tag.tests_failed,.tag.broken_code{color:var(--bad);border-color:var(--bad)}.tag.timeout,.tag.no_changes,.tag.agent_error{color:var(--mid);border-color:var(--mid)}
details.attempt{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:8px 0}
details.attempt summary{cursor:pointer;padding:12px 14px}
details .body{padding:0 14px 14px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;max-height:420px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre}
pre.log{white-space:pre-wrap;word-break:break-word}
.diff .a{color:var(--ok)}.diff .d{color:var(--bad)}.diff .h{color:#58a6ff}.diff .f{color:var(--muted);font-weight:700}
.warn{color:var(--mid)}
h4{margin:14px 0 6px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
footer{margin-top:48px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
a{color:var(--accent)}
</style></head><body><main>
<header>
  <div><div class="brand">FAULTLINE <span>BENCH</span></div><div class="muted">Find the best AI coding agent for your codebase</div></div>
  <div class="muted">Run ${esc(report.runId)} · ${esc(new Date(report.startedAt).toLocaleString())}<br>${esc(environment.os)} · Node ${esc(environment.node)}</div>
</header>

<section class="hero">
  <div class="card"><div class="muted">Top agent</div><div class="big">${esc(best ? best.name : '-')}</div><div class="muted">${best ? Math.round(best.solveRate * 100) + '% of tasks solved' : ''}</div></div>
  <div class="card"><div class="muted">Agents compared</div><div class="big">${summary.length}</div></div>
  <div class="card"><div class="muted">Scenarios × runs</div><div class="big">${scenarios.length} × ${config.repeat}</div><div class="muted">suite: ${esc(config.suite)}</div></div>
  <div class="card"><div class="muted">Total agent time</div><div class="big">${fmtDuration(summary.reduce((a, r) => a + r.totalDurationMs, 0))}</div></div>
</section>

<h2>Leaderboard</h2>
<div class="scroll"><table>
<tr><th>#</th><th>Agent</th><th>Solved</th><th>Hidden tests passed</th><th>Median time</th><th>Tokens</th><th>Cost</th>${config.repeat > 1 ? '<th>Consistent</th><th>Solved every run</th>' : ''}<th>Failure reasons</th></tr>
${leaderboard}
</table></div>
<p class="muted">Solved = every hidden test passes. Hidden tests are copied in only after the agent finishes, so agents cannot see or edit them. Tokens and cost appear only when the agent CLI reports them; subscription plans often report tokens but no price.${config.repeat > 1 ? ' Consistent = share of scenarios where all repeated runs gave the same result.' : ' Run with --repeat 3 to measure reliability.'}</p>

<h2>Scenario matrix</h2>
<div class="scroll"><table><tr><th>Scenario</th>${matrixHead}</tr>
${matrixRows}
</table></div>

<h2>Every attempt</h2>
${details}

<footer>Generated by <strong>Faultline Bench ${esc(report.version)}</strong>, free and open source. Runs locally: no account, no telemetry, no code uploaded.
Raw data: <a href="results.json">results.json</a></footer>
</main></body></html>`;
}

function writeReports(report, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'results.json');
  const htmlPath = path.join(outDir, 'report.html');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, buildHtml(report, outDir));
  return { jsonPath, htmlPath };
}

module.exports = { summarize, printSummary, writeReports, buildHtml };
