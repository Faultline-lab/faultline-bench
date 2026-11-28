'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { c, fmtDuration, fmtTokens, fmtCost } = require('./util');
const { CATEGORY_LABEL } = require('./runner');
const { summarizeAll, summarizeAgent } = require('./metrics');
const { AGENTS, BUILTIN } = require('./agents');

const MAX_INLINE_IMAGE_BYTES = 600 * 1024;
const IMAGE_MIME = { '.svg': 'image/svg+xml', '.png': 'image/png' };

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function toMetricsAttempts(results) {
  return results.map((r) => ({
    ...r,
    costUsd: r.costUsd ?? r.usage?.costUsd ?? null,
    inputTokens: r.inputTokens ?? r.usage?.inputTokens ?? null,
    outputTokens: r.outputTokens ?? r.usage?.outputTokens ?? null,
  }));
}

function summarize(results, agents, scenarios, repeat) {
  const byAgent = summarizeAll(toMetricsAttempts(results));
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
      webLookups: mine.filter((r) => r.webLookup && r.webLookup.detected).length,
      metrics: byAgent[agent.id] || summarizeAgent([]),
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
  if (config.repeat > 1) head.push('Same result every run', 'Solved every run');
  const nameW = Math.max(6, ...summary.map((r) => r.name.length));
  const widths = config.repeat > 1 ? [3, nameW, 12, 7, 12, 9, 9, 21, 16] : [3, nameW, 12, 7, 12, 9, 9];
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
    if (config.repeat > 1) {
      const passHat = r.metrics?.passHatK?.[config.repeat] ?? r.passAllRate;
      cells.push(r.consistency == null ? '-' : pct(r.consistency));
      cells.push(passHat == null ? '-' : pct(passHat));
    }
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

// ---------- log tail ----------
// Agent CLIs print machine output: Claude and agy one JSON object (result /
// response), Codex and OpenCode JSONL events (item.text / part.text). Readers
// want the final message, so pull it out and fall back to the raw tail.
function jsonOrNull(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function messageOf(ev) {
  if (!ev || typeof ev !== 'object') return '';
  if (typeof ev.result === 'string' && ev.result.trim()) return ev.result; // claude
  if (typeof ev.response === 'string' && ev.response.trim()) return ev.response; // agy
  const item = ev.item;
  if (item && item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) return item.text; // codex
  const part = ev.part;
  if (part && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) return part.text; // opencode
  return '';
}

function tail(s, max) {
  return s.length > max ? `… (${s.length - max} earlier characters omitted)\n` + s.slice(-max) : s;
}

// The agent's final message from raw CLI output, or the raw tail when nothing parses.
function logTailText(raw, max = 6000) {
  const full = String(raw == null ? '' : raw);
  const whole = jsonOrNull(full.trim());
  // JSONL: scan backwards so the last message (the final one) wins.
  const events = whole
    ? [whole]
    : full
        .split(/\r?\n/)
        .reverse()
        .map((l) => jsonOrNull(l.trim()))
        .filter(Boolean);
  for (const ev of events) {
    const msg = messageOf(ev);
    if (msg) return tail(msg, max);
  }
  return tail(full, max);
}

function readTail(file, max) {
  try {
    return logTailText(fs.readFileSync(file, 'utf8'), max);
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

function scenarioDescription(s) {
  if (s.description) return String(s.description).trim();
  if (s.task) return String(s.task).split(/\r?\n/).find((l) => l.trim()) || '';
  return [s.category, s.difficulty].filter(Boolean).join(' · ');
}

function renderMediaHtml(relPath, outDir, altText, emptyText) {
  if (!relPath) {
    return `<div class="render-empty">${emptyText ? `<div class="render-error">${esc(emptyText)}</div>` : 'No render produced.'}</div>`;
  }
  const cleanRel = String(relPath).replace(/\\/g, '/');
  const abs = path.resolve(outDir, relPath);
  // Only files inside the output folder: results.json can be edited, and the report must never embed other files.
  const inside = path.relative(path.resolve(outDir), abs);
  if (path.isAbsolute(String(relPath)) || !inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    return `<div class="render-empty"><div class="render-error">Render path outside the report folder was ignored.</div></div>`;
  }
  const mime = IMAGE_MIME[path.extname(cleanRel).toLowerCase()];
  try {
    const stat = fs.statSync(abs);
    if (!mime) {
      return `<div class="render-large"><a href="${esc(cleanRel)}" target="_blank" rel="noopener">Open ${esc(path.basename(cleanRel))}</a></div>`;
    }
    if (stat.size > MAX_INLINE_IMAGE_BYTES) {
      return `<div class="render-large"><a href="${esc(cleanRel)}" target="_blank" rel="noopener">Open full render (${Math.round(stat.size / 1024)}&nbsp;KB)</a><div class="muted">Linked (&gt;600&nbsp;KB)</div></div>`;
    }
    const uri = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
    // Link to the file itself: browsers refuse to open data: URIs in a new tab, and a second copy would double the size.
    return `<a class="render-link" href="${esc(cleanRel)}" target="_blank" rel="noopener" title="Open full size"><img src="${uri}" alt="${esc(altText)}" decoding="async"></a>`;
  } catch {
    return `<div class="render-empty">${emptyText ? `<div class="render-error">${esc(emptyText)}</div>` : `Render missing (${esc(cleanRel)})`}</div>`;
  }
}

function webBadgeHtml(a, cls) {
  if (!a.webLookup || !a.webLookup.detected) return '';
  const tip = (a.webLookup.evidence || []).join('\n') || 'Web lookup detected';
  return `<span class="${cls}" title="${esc(tip)}">looked up the web</span>`;
}

function buildGalleryHtml(report, outDir, nameOf) {
  const { attempts, scenarios, config } = report;
  const references = report.references || {};
  const visual = scenarios.filter(
    (s) => s.render || references[s.id] || attempts.some((a) => a.scenario === s.id && (a.files?.render || a.renderError))
  );
  if (!visual.length) return '';

  const blocks = visual
    .map((s) => {
      const cards = [];
      if (references[s.id]) {
        cards.push(`<article class="render-card ref">
  <div class="render-media">${renderMediaHtml(references[s.id], outDir, `Reference render for ${s.title || s.id}`, 'Reference render missing.')}</div>
  <div class="render-meta">
    <div class="render-top"><span class="badge ref">Reference</span><strong>Reference solution</strong></div>
    <div class="muted">Expected output</div>
  </div>
</article>`);
      }
      const runs = attempts
        .filter((a) => a.scenario === s.id)
        .slice()
        .sort((a, b) => a.agent.localeCompare(b.agent) || a.rep - b.rep);
      for (const a of runs) {
        const agentName = nameOf(a.agent);
        const statusBadge = `<span class="badge ${a.passed ? 'pass' : 'fail'}">${a.passed ? 'PASS' : 'FAIL'}</span>`;
        const webBadge = webBadgeHtml(a, 'badge web');
        const runTag = config.repeat > 1 ? ` · run ${a.rep}` : '';
        const cat = !a.passed ? `<div class="muted">${esc(CATEGORY_LABEL[a.category] || a.category)}</div>` : '';
        const testsStr = `${a.tests?.passed ?? 0}/${a.tests?.total ?? 0} tests`;
        cards.push(`<article class="render-card">
  <div class="render-media">${renderMediaHtml(a.files?.render, outDir, `${agentName} render for ${s.title || s.id}`, a.renderError)}</div>
  <div class="render-meta">
    <div class="render-top">${statusBadge}${webBadge ? ' ' + webBadge : ''}<strong>${esc(agentName)}</strong></div>
    <div class="muted">${testsStr} · ${fmtDuration(a.durationMs)}${esc(runTag)} · <a href="#${esc(a.agent)}-${esc(a.scenario)}-r${esc(a.rep)}">details</a></div>
    ${cat}
  </div>
</article>`);
      }
      const desc = scenarioDescription(s);
      return `<div class="gallery-block">
  <h3>${esc(s.title || s.id)}</h3>
  ${desc ? `<p class="muted gallery-desc">${esc(desc)}</p>` : ''}
  <div class="gallery-grid">${cards.join('\n')}</div>
</div>`;
    })
    .join('\n');

  return `<section class="gallery">
<h2>See the results</h2>
${blocks}
</section>`;
}

function buildHtml(report, outDir) {
  const { summary, attempts, scenarios, config, environment } = report;
  const best = summary[0];
  const bar = (x) => `<div class="bar"><span style="width:${Math.round(x * 100)}%"></span></div>`;
  const nameOf = (id) =>
    (summary.find((r) => r.agent === id) || {}).name ||
    ((report.agents || []).find((a) => a.id === id) || {}).name ||
    id;
  const fallbackMetrics = summarizeAll(toMetricsAttempts(attempts));

  const leaderboard = summary
    .map((r) => {
      const m = r.metrics || fallbackMetrics[r.agent] || summarizeAgent([]);
      const webLookups = r.webLookups ?? attempts.filter((a) => a.agent === r.agent && a.webLookup && a.webLookup.detected).length;
      const passHat = m.passHatK?.[config.repeat] ?? (config.repeat > 1 ? r.passAllRate : null);
      const passAt = m.passAtK?.[config.repeat] ?? null;
      const flaky = m.flakyScenarios || [];
      const ci = m.solveRateCI;
      const repCols =
        config.repeat > 1
          ? `<td class="num">${r.consistency != null ? pct(r.consistency) : '-'}</td>
  <td class="num">${passHat != null ? pct(passHat) : '-'}</td>
  <td class="num">${passAt != null ? pct(passAt) : '-'}</td>
  <td class="num" title="${esc(flaky.join(', '))}">${flaky.length}</td>`
          : '';
      return `<tr>
  <td class="rank">${r.rank}</td>
  <td><strong>${esc(r.name)}</strong><div class="muted">${esc(r.version || '')}</div></td>
  <td><div class="score">${pct(r.solveRate)}</div>${bar(r.solveRate)}<div class="muted">${r.passed}/${r.attempts} solved</div>${config.repeat > 1 && ci ? `<div class="muted" title="95% Wilson confidence interval">95% CI ${pct(ci[0])}–${pct(ci[1])}</div>` : ''}</td>
  <td class="num">${pct(r.testPassRate)}</td>
  <td class="num"><div>${fmtDuration(r.medianDurationMs)}</div>${config.repeat > 1 ? `<div class="muted" title="Time per solved task">per solve: ${m.timePerSolveMs != null ? fmtDuration(m.timePerSolveMs) : '-'}</div>` : ''}</td>
  <td class="num">${fmtTokens((r.inputTokens || 0) + (r.outputTokens || 0))}</td>
  <td class="num"><div>${fmtCost(r.costUsd)}</div>${config.repeat > 1 ? `<div class="muted" title="Cost per solved task">per solve: ${m.costPerSolve != null ? fmtCost(m.costPerSolve) : '-'}</div>` : ''}</td>
  ${repCols}
  <td class="num">${webLookups > 0 ? `<span class="tag web">${webLookups}</span>` : '0'}</td>
  <td>${Object.entries(r.failures)
    .map(([k, n]) => `<span class="tag ${k}">${esc(CATEGORY_LABEL[k] || k)} ×${n}</span>`)
    .join(' ') || '<span class="muted">none</span>'}</td>
</tr>`;
    })
    .join('\n');

  const reportAgents =
    Array.isArray(report.agents) && report.agents.length
      ? report.agents
      : summary.map((r) => ({ id: r.agent, name: r.name }));
  const unblockedAgents = reportAgents.filter((a) => {
    if (typeof a.webBlocked === 'boolean') return !a.webBlocked;
    if (a.builtin || BUILTIN.some((b) => b.id === a.id)) return false;
    const known = AGENTS.find((x) => x.id === a.id);
    return known ? !known.webBlocked : false;
  });

  const matrixHead = summary.map((r) => `<th>${esc(r.name)}</th>`).join('');
  const matrixRows = scenarios
    .map((s) => {
      const cells = summary
        .map((r) => {
          const reps = attempts.filter((a) => a.agent === r.agent && a.scenario === s.id);
          const k = reps.filter((a) => a.passed).length;
          const cls = k === reps.length ? 'ok' : k === 0 ? 'bad' : 'mixed';
          const tests = reps.map((a) => `${a.tests.passed}/${a.tests.total}`).join(', ');
          // Link to the first run of this pair; each attempt has its own id (…-r<rep>).
          const label = `${k === reps.length ? '✓' : k === 0 ? '✗' : '◐'} ${k}/${reps.length}`;
          const link = reps.length ? `<a href="#${esc(r.agent)}-${esc(s.id)}-r${esc(reps[0].rep)}">${label}</a>` : label;
          return `<td class="cell ${cls}">${link}<div class="muted">tests ${tests} · ${fmtDuration(median(reps.map((a) => a.durationMs)))}</div></td>`;
        })
        .join('');
      return `<tr><td><strong>${esc(s.title)}</strong><div class="muted">${esc(s.category)} · ${esc(s.difficulty)}</div></td>${cells}</tr>`;
    })
    .join('\n');

  const details = attempts
    .slice()
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.scenario.localeCompare(b.scenario) || a.rep - b.rep)
    .map((a) => {
      const agentName = nameOf(a.agent);
      const s = scenarios.find((x) => x.id === a.scenario) || { title: a.scenario };
      const diff = readHead(path.join(outDir, a.files.diff), 60000);
      const log = readTail(path.join(outDir, a.files.log), 6000);
      const webBadge = webBadgeHtml(a, 'tag web');
      return `<details id="${esc(a.agent)}-${esc(a.scenario)}-r${esc(a.rep)}" class="attempt">
<summary><span class="tag ${a.category}">${a.passed ? '✓ Passed' : esc(CATEGORY_LABEL[a.category])}</span>${webBadge ? ' ' + webBadge : ''} <strong>${esc(agentName)}</strong> · ${esc(s.title)} · run ${a.rep}
<span class="muted">· tests ${a.tests.passed}/${a.tests.total} · ${fmtDuration(a.durationMs)} · ${a.changes.files.length} files (+${a.changes.insertions} −${a.changes.deletions})${a.usage.costUsd != null ? ' · ' + fmtCost(a.usage.costUsd) : ''}</span></summary>
<div class="body">
${a.touchedTests.length ? `<p class="warn">Note: the agent edited test files (${esc(a.touchedTests.join(', '))}). Grading uses separate hidden tests, so this does not affect the score.</p>` : ''}
${a.webLookup?.detected && a.webLookup.evidence?.length ? `<p class="warn">Web lookup detected: ${a.webLookup.evidence.map((e) => `<code>${esc(e)}</code>`).join(', ')}</p>` : ''}
${a.tests.failures.length ? `<h4>Failing hidden tests</h4><ul>${a.tests.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
<h4>Code changes</h4>${diffHtml(diff)}
<h4>Agent output (tail)</h4><pre class="log">${esc(log) || '<span class="muted">No output.</span>'}</pre>
<p class="muted">Full log: <a href="${esc(pathToFileURL(path.resolve(outDir, a.files.log)).href)}">${esc(a.files.log)}</a> · exit code ${a.exitCode}${a.timedOut ? ' · timed out' : ''}</p>
</div></details>`;
    })
    .join('\n');

  const galleryHtml = buildGalleryHtml(report, outDir, nameOf);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Faultline Bench report · ${esc(report.runId)}</title>
<style>
:root{color-scheme:dark light;--bg:#0d1117;--panel:#151b23;--line:#262f3a;--text:#e6edf3;--muted:#8b98a7;--accent:#ff6b35;--ok:#3fb950;--bad:#f85149;--mid:#d29922}
@media (prefers-color-scheme: light){:root{--bg:#f7f8fa;--panel:#fff;--line:#e3e7ec;--text:#1b2330;--muted:#5d6b7a;--accent:#e4572e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 20px 64px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:20px}
.brand{font-weight:800;letter-spacing:.02em;font-size:22px}.brand span{color:var(--accent)}
.muted{color:var(--muted);font-size:13px}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:24px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
.card .big{font-size:26px;font-weight:700}
h2{margin:36px 0 12px;font-size:18px;text-wrap:balance}
h3{text-wrap:balance}
.gallery-block{margin-top:20px}.gallery-block h3{margin:0 0 4px;font-size:16px}.gallery-desc{margin:0 0 12px}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.render-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;transition:border-color 140ms ease}
.render-card:hover{border-color:var(--muted)}
.render-card.ref{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}
.render-media{background:#0b0f14;border-bottom:1px solid var(--line);aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px}
.render-link{display:flex;width:100%;height:100%;align-items:center;justify-content:center}
.render-media img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block}
.render-empty,.render-large{padding:12px;text-align:center;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.render-error{color:var(--bad);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;white-space:pre-wrap}
.render-meta{padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:13px;min-width:0}
.render-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}.render-top strong{overflow-wrap:anywhere}
.badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;padding:1px 7px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.badge.pass{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent)}
.badge.fail{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.badge.ref{color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
.badge.web,.tag.web{color:var(--mid);border-color:var(--mid)}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
tr:last-child td{border-bottom:none}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
td.rank{font-weight:700;color:var(--accent);width:32px}
td.num{white-space:nowrap}
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
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
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

${galleryHtml}

<h2>Leaderboard</h2>
<div class="table-wrap"><table>
<tr><th>#</th><th>Agent</th><th>Solved</th><th>Hidden tests passed</th><th>Median time</th><th>Tokens</th><th>Cost</th>${config.repeat > 1 ? '<th>Same result every run</th><th>Solved every run</th><th>Solved at least once</th><th>Flaky scenarios</th>' : ''}<th>Web lookups</th><th>Failure reasons</th></tr>
${leaderboard}
</table></div>
<p class="muted">Solved = every hidden test passes. Hidden tests are copied in only after the agent finishes, so agents cannot see or edit them. Tokens and cost appear only when the agent CLI reports them; subscription plans often report tokens but no price.${config.repeat > 1 ? ' Same result every run = share of scenarios where all repeated runs gave the same result.' : ' Run with --repeat 3 to measure reliability.'}</p>
${unblockedAgents.length ? `<p class="muted">Web search cannot be blocked by CLI flags for: ${unblockedAgents.map((a) => esc(a.name || a.id)).join(', ')} (asked in prompt not to search; detected lookups are flagged).</p>` : ''}

<h2>Scenario matrix</h2>
<div class="table-wrap"><table><tr><th>Scenario</th>${matrixHead}</tr>
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

module.exports = { summarize, printSummary, writeReports, buildHtml, logTailText };
