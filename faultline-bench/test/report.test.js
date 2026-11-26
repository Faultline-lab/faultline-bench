'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { summarize, buildHtml } = require('../src/report');

const agents = [{ id: 'alpha', name: 'Alpha Agent', version: '1.0' }];
const scenarios = [{ id: 'fix-bug', title: 'Fix the bug', category: 'debug', difficulty: 'easy' }];

function attempt(rep, passed) {
  return {
    agent: 'alpha',
    scenario: 'fix-bug',
    rep,
    startedAt: 0,
    passed,
    category: passed ? 'passed' : 'tests_failed',
    durationMs: 1000 * rep,
    exitCode: 0,
    timedOut: false,
    tests: { total: 2, passed: passed ? 2 : 1, failed: passed ? 0 : 1, failures: [] },
    usage: { inputTokens: 10, outputTokens: 5, costUsd: null, turns: 1 },
    changes: { files: ['src/x.js'], insertions: 1, deletions: 0 },
    touchedTests: [],
    files: { log: `logs/alpha-fix-bug-r${rep}.log`, diff: `logs/alpha-fix-bug-r${rep}.diff` },
  };
}

const outDir = path.join('/tmp', 'faultline-out');
const attempts = [attempt(1, true), attempt(2, false)];

function html() {
  const report = {
    runId: 'test-run',
    startedAt: 0,
    version: '0.0.0',
    summary: summarize(attempts, agents, scenarios, 2),
    attempts,
    scenarios,
    config: { repeat: 2, suite: 'smoke' },
    environment: { os: 'test-os', node: 'v0' },
  };
  return buildHtml(report, outDir);
}

const ids = (h) => [...h.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
const hashTargets = (h) => [...h.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]);

test('every id attribute is unique with --repeat 2', () => {
  const found = ids(html());
  assert.deepStrictEqual(found, [...new Set(found)], `duplicate ids: ${found.join(', ')}`);
  assert.ok(found.includes('alpha-fix-bug-r1'));
  assert.ok(found.includes('alpha-fix-bug-r2'));
});

test('every matrix link points at an existing id', () => {
  const h = html();
  const targets = hashTargets(h);
  assert.ok(targets.length > 0, 'expected at least one matrix link');
  const existing = new Set(ids(h));
  for (const t of targets) assert.ok(existing.has(t), `dangling href="#${t}"`);
});

test('matrix links the first run of each agent/scenario pair', () => {
  assert.ok(hashTargets(html()).includes('alpha-fix-bug-r1'));
});

test('full log path is a file:// link', () => {
  const h = html();
  const expected = pathToFileURL(path.join(outDir, attempts[0].files.log)).href;
  assert.ok(h.includes(`href="${expected}"`), `missing log link ${expected}`);
});

test('a pair with no attempts renders no dangling link', () => {
  const h = buildHtml({
    runId: 'empty', startedAt: 0, version: '0.0.0',
    summary: summarize([], agents, scenarios, 1), attempts: [], scenarios,
    config: { repeat: 1, suite: 'smoke' }, environment: { os: 'test-os', node: 'v0' },
  }, outDir);
  const have = new Set(ids(h));
  for (const t of hashTargets(h)) assert.ok(have.has(t), `dangling link #${t}`);
});
