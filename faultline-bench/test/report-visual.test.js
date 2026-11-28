'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { summarize, printSummary, buildHtml, writeReports } = require('../src/report');

// Minimal valid 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4" fill="#3fb950"/></svg>';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'faultline-report-visual-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeAttempt({
  agent,
  scenario,
  rep,
  passed,
  category = passed ? 'passed' : 'tests_failed',
  durationMs = 2000,
  costUsd = null,
  render = null,
  renderError = null,
  webLookup = { detected: false, evidence: [] },
}) {
  return {
    agent,
    scenario,
    rep,
    startedAt: 0,
    passed,
    category,
    durationMs,
    exitCode: 0,
    timedOut: false,
    tests: { total: 4, passed: passed ? 4 : 2, failed: passed ? 0 : 2, failures: passed ? [] : ['edge case'] },
    usage: { inputTokens: 100, outputTokens: 50, costUsd, turns: 1 },
    changes: { files: ['src/a.js'], insertions: 2, deletions: 1 },
    touchedTests: [],
    webLookup,
    renderError,
    files: {
      log: `attempts/${agent}__${scenario}__r${rep}.log`,
      diff: `attempts/${agent}__${scenario}__r${rep}.diff`,
      render,
    },
  };
}

function makeFixture(dir) {
  fs.mkdirSync(path.join(dir, 'reference'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'attempts'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'reference', 'raytracer.render.png'), TINY_PNG);
  fs.writeFileSync(path.join(dir, 'attempts', 'codex__raytracer__r1.render.png'), TINY_PNG);
  fs.writeFileSync(path.join(dir, 'attempts', 'claude__spinning-hexagon__r1.render.svg'), TINY_SVG);
  // > 600 KB file must be linked rather than embedded inline.
  fs.writeFileSync(path.join(dir, 'attempts', 'codex__spinning-hexagon__r1.render.svg'), '<svg>' + 'a'.repeat(620 * 1024) + '</svg>');

  const agents = [
    { id: 'claude', name: 'Claude Code', version: '2.1', webBlocked: true },
    { id: 'codex', name: 'Codex <script>alert(1)</script> & "CLI"', version: '0.1', webBlocked: false },
  ];
  const scenarios = [
    { id: 'raytracer', title: 'Fix a small ray tracer', category: 'graphics', difficulty: 'hard', render: 'png', description: 'Render spheres with shadows and reflection.' },
    { id: 'spinning-hexagon', title: 'Spinning hexagon', category: 'physics', difficulty: 'hard', render: 'svg', description: 'Keep balls inside a rotating hexagon.' },
  ];

  // Repeat = 2:
  // claude: raytracer passes 2/2 (consistent, solved every run), spinning-hexagon passes 1/2 (flaky!)
  //   -> passHatK[2] = (1 + 0) / 2 = 0.5 (50%), passAtK[2] = (1 + 1) / 2 = 1.0 (100%), consistency = 50%
  // codex: raytracer fails 0/2 (renderError on r2), spinning-hexagon fails 0/2
  const attempts = [
    makeAttempt({ agent: 'claude', scenario: 'raytracer', rep: 1, passed: true, durationMs: 4000, costUsd: 0.2, render: null, renderError: 'missing render on claude r1' }),
    makeAttempt({ agent: 'claude', scenario: 'raytracer', rep: 2, passed: true, durationMs: 6000, costUsd: 0.4, render: null, renderError: 'missing render on claude r2' }),
    makeAttempt({ agent: 'claude', scenario: 'spinning-hexagon', rep: 1, passed: true, durationMs: 2000, costUsd: 0.1, render: 'attempts/claude__spinning-hexagon__r1.render.svg' }),
    makeAttempt({ agent: 'claude', scenario: 'spinning-hexagon', rep: 2, passed: false, category: 'tests_failed', durationMs: 2000, costUsd: 0.1, render: null, renderError: 'render exited with code 1: <img src=x onerror=alert(1)>' }),
    makeAttempt({
      agent: 'codex',
      scenario: 'raytracer',
      rep: 1,
      passed: false,
      category: 'tests_failed',
      durationMs: 3000,
      costUsd: null,
      render: 'attempts/codex__raytracer__r1.render.png',
      webLookup: { detected: true, evidence: ['WebSearch: "raytracer shadow <script>"'] },
    }),
    makeAttempt({ agent: 'codex', scenario: 'raytracer', rep: 2, passed: false, category: 'broken_code', durationMs: 5000, costUsd: null, render: null, renderError: 'render exited with code 1: SyntaxError' }),
    makeAttempt({ agent: 'codex', scenario: 'spinning-hexagon', rep: 1, passed: false, category: 'tests_failed', durationMs: 3000, costUsd: null, render: 'attempts/codex__spinning-hexagon__r1.render.svg' }),
    makeAttempt({ agent: 'codex', scenario: 'spinning-hexagon', rep: 2, passed: false, category: 'no_changes', durationMs: 1000, costUsd: null, render: null, renderError: 'no output produced' }),
  ];

  const summary = summarize(attempts, agents, scenarios, 2);
  return {
    tool: 'faultline-bench',
    version: '0.2.0',
    runId: 'visual-test-run',
    startedAt: 0,
    finishedAt: 1000,
    environment: { os: 'test-os', node: 'v26' },
    config: { suite: 'visual', repeat: 2, timeoutSec: 600, models: {} },
    agents,
    scenarios,
    references: { raytracer: 'reference/raytracer.render.png' },
    summary,
    attempts,
  };
}

const outDir = path.join(tmp, 'out');
const report = makeFixture(outDir);

test('gallery embeds tiny PNG and SVG data URIs, puts Reference card first, and links >600 KB files', () => {
  const html = buildHtml(report, outDir);

  assert.ok(html.includes('See the results'), 'missing See the results section');
  assert.ok(html.indexOf('See the results') < html.indexOf('<h2>Leaderboard</h2>'), 'gallery must appear before Leaderboard');
  assert.ok(html.includes(`data:image/png;base64,${TINY_PNG.toString('base64')}`), 'missing embedded PNG data URI');
  assert.ok(html.includes(`data:image/svg+xml;base64,${Buffer.from(TINY_SVG).toString('base64')}`), 'missing embedded SVG data URI');

  // > 600 KB file is linked, not embedded as base64 data URI.
  assert.ok(html.includes('href="attempts/codex__spinning-hexagon__r1.render.svg"'), 'large file should be linked');
  assert.ok(!html.includes(Buffer.from('a'.repeat(1024)).toString('base64')), 'large file must not be base64-embedded');

  // Reference card appears before the first raytracer attempt card.
  const galleryStart = html.indexOf('See the results');
  const rayBlock = html.slice(galleryStart, html.indexOf('Spinning hexagon', galleryStart));
  const refPos = rayBlock.indexOf('Reference');
  const firstAttemptPos = rayBlock.indexOf('Claude Code');
  assert.ok(refPos >= 0 && firstAttemptPos > refPos, 'Reference card must appear before agent cards');
});

test('gallery cards show PASS/FAIL badges, run N, tests, failure category, time, renderError, and clickable picture', () => {
  const html = buildHtml(report, outDir);
  const galleryHtml = html.slice(html.indexOf('See the results'), html.indexOf('<h2>Leaderboard</h2>'));

  assert.match(galleryHtml, />\s*PASS\s*</);
  assert.match(galleryHtml, />\s*FAIL\s*</);
  assert.ok(galleryHtml.includes('run 1') && galleryHtml.includes('run 2'), 'missing run N label when repeat > 1');
  assert.ok(galleryHtml.includes('4/4'), 'missing passing test count');
  assert.ok(galleryHtml.includes('2/4'), 'missing failing test count');
  assert.ok(galleryHtml.includes('Wrong behavior (tests fail)'), 'missing failure category label');
  assert.ok(galleryHtml.includes('Code does not load / tests crash'), 'missing broken_code category label');
  assert.ok(galleryHtml.includes('render exited with code 1: SyntaxError'), 'missing renderError text');
  assert.match(galleryHtml, /<a\b[^>]*href="[^"]+\.png"[^>]*>\s*<img\b[^>]*src="data:image\/png;base64,/);
});

test('web lookups show badge with evidence tooltip in gallery & details, leaderboard count, and unblocked CLI note', () => {
  const html = buildHtml(report, outDir);

  assert.ok(html.includes('looked up the web'), 'missing looked up the web badge');
  assert.ok(html.includes('WebSearch: &quot;raytracer shadow &lt;script&gt;&quot;'), 'missing escaped web evidence tooltip');
  assert.ok(html.includes('Web lookups'), 'missing Web lookups leaderboard column');

  const galleryHtml = html.slice(html.indexOf('See the results'), html.indexOf('<h2>Leaderboard</h2>'));
  const detailsHtml = html.slice(html.indexOf('<h2>Every attempt</h2>'));
  assert.ok(galleryHtml.includes('looked up the web'), 'gallery card missing web lookup badge');
  assert.ok(detailsHtml.includes('looked up the web'), 'attempt details missing web lookup badge');

  // Unblocked agents listed under leaderboard; Claude Code (webBlocked: true) must NOT be listed as unblocked.
  const afterTable = html.slice(html.indexOf('</table>'), html.indexOf('<h2>Scenario matrix</h2>'));
  assert.ok(afterTable.includes('Codex &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;CLI&quot;'));
  assert.ok(!afterTable.includes('Claude Code'), 'webBlocked agent should not be listed as unable to block web search');
});

test('reliability metrics from summarizeAll appear in leaderboard, results.json, and console summary', () => {
  // summary[].metrics is populated and written to results.json.
  const { jsonPath } = writeReports(report, outDir);
  const written = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const claudeRow = written.summary.find((r) => r.agent === 'claude');
  const codexRow = written.summary.find((r) => r.agent === 'codex');

  assert.ok(claudeRow.metrics, 'results.json summary row must include metrics');
  assert.strictEqual(claudeRow.metrics.passHatK[2], 0.5);
  assert.strictEqual(claudeRow.metrics.passAtK[2], 1);
  assert.deepStrictEqual(claudeRow.metrics.flakyScenarios, ['spinning-hexagon']);
  assert.strictEqual(codexRow.metrics.costPerSolve, null);
  assert.strictEqual(codexRow.metrics.timePerSolveMs, null);

  const html = buildHtml(report, outDir);
  const lb = html.slice(html.indexOf('<h2>Leaderboard</h2>'), html.indexOf('<h2>Scenario matrix</h2>'));
  assert.ok(lb.includes('Same result every run'), 'Consistent must be renamed to Same result every run');
  assert.ok(lb.includes('Solved every run'), 'missing Solved every run column');
  assert.ok(lb.includes('Solved at least once'), 'missing Solved at least once column');
  assert.ok(lb.includes('title="spinning-hexagon"'), 'missing flaky scenario id in title tooltip');
  assert.ok(lb.includes('50%'), 'missing Solved every run 50% for claude');
  assert.ok(lb.includes('100%'), 'missing Solved at least once 100% for claude');
  assert.ok(lb.includes('95%'), 'missing 95% confidence interval');
  assert.ok(lb.includes('-'), 'null per-solve cost/time must render -');

  // printSummary prints 'Solved every run' when repeat > 1.
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    printSummary(report);
  } finally {
    console.log = origLog;
  }
  const out = lines.join('\n');
  assert.ok(out.includes('Solved every run'), 'console summary missing Solved every run');
  assert.ok(out.includes('50%'), 'console summary missing claude 50% Solved every run');
});

test('all agent names, renderErrors, and evidence are HTML-escaped', () => {
  const html = buildHtml(report, outDir);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'unescaped script tag leaked');
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'unescaped img tag leaked');
  assert.ok(html.includes('Codex &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;CLI&quot;'));
});

test('render paths outside the output folder are never read or embedded', () => {
  const secretDir = path.join(tmp, 'secret');
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(secretDir, 'private.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>TOP-SECRET-MARKER</text></svg>');
  const out = path.join(tmp, 'escape-out');
  const r = makeFixture(out);
  r.references = { ...(r.references || {}) };
  const first = r.scenarios.find((s) => s.render) || r.scenarios[0];
  r.references[first.id] = '../secret/private.svg';
  const a = r.attempts.find((x) => x.files && x.files.render);
  a.files.render = path.join(secretDir, 'private.svg');
  const html = buildHtml(r, out);
  const secretB64 = Buffer.from(fs.readFileSync(path.join(secretDir, 'private.svg'))).toString('base64');
  assert.ok(!html.includes(secretB64), 'secret file was embedded');
  assert.ok(!html.includes('TOP-SECRET-MARKER'), 'secret file content leaked');
});

test('clicking a picture opens the file, and each image is embedded once', () => {
  const html = buildHtml(report, outDir);
  assert.ok(!/href="data:/.test(html), 'no data: URI links');
  assert.match(html, /class="render-link" href="[^"]+\.(svg|png)"/);
});
