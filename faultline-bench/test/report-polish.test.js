'use strict';

// The per-attempt HTML log tail used to dump raw CLI JSON/JSONL at the reader.
// logTailText() keeps the agent's final message readable and falls back to the
// raw tail when nothing parses.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { summarize, buildHtml, logTailText } = require('../src/report');

const MESSAGE = 'Refactored the parser and every hidden test passes.';

test('claude: one JSON object, message in result', () => {
  const raw = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: MESSAGE,
    usage: { input_tokens: 10, output_tokens: 5 },
    total_cost_usd: 0.02,
  });
  assert.strictEqual(logTailText(raw), MESSAGE);
});

test('codex: JSONL events, last agent_message wins', () => {
  const raw = [
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"item.completed","item":{"type":"reasoning","text":"internal thinking"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"Opening the file."}}',
    `{"type":"item.completed","item":{"type":"agent_message","text":${JSON.stringify(MESSAGE)}}}`,
    '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}',
  ].join('\n');
  assert.strictEqual(logTailText(raw), MESSAGE);
});

test('opencode: JSONL events, last text part wins', () => {
  const raw = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"text","part":{"type":"text","text":"Reading the tests."}}',
    `{"type":"text","part":{"type":"text","text":${JSON.stringify(MESSAGE)}}}`,
    '{"type":"step_finish","part":{"tokens":{"input":10,"output":5},"cost":0.01}}',
  ].join('\n');
  assert.strictEqual(logTailText(raw), MESSAGE);
});

test('agy: one JSON object, message in response', () => {
  const raw = JSON.stringify({
    conversation_id: 'c1',
    response: MESSAGE,
    usage: { input_tokens: 5, output_tokens: 2 },
  });
  assert.strictEqual(logTailText(raw), MESSAGE);
});

test('plain text is passed through unchanged', () => {
  const raw = 'plain stdout line one\nplain stdout line two\n';
  assert.strictEqual(logTailText(raw), raw);
});

test('invalid JSON falls back to the raw text', () => {
  const raw = '{"type":"result","result":"cut off here';
  assert.strictEqual(logTailText(raw), raw);
});

test('JSON without a known message field falls back to the raw text', () => {
  const raw = JSON.stringify({ usage: { input_tokens: 3 }, type: 'turn.completed' });
  assert.strictEqual(logTailText(raw), raw);
});

test('a long message keeps the last characters and says how many were dropped', () => {
  const raw = JSON.stringify({ result: 'x'.repeat(500) + 'THE END' });
  const out = logTailText(raw, 100);
  assert.ok(out.startsWith('… (') && out.includes('earlier characters omitted'), out.slice(0, 40));
  assert.ok(out.endsWith('THE END'), 'tail must keep the end of the message');
  assert.ok(out.length < 200, `expected a short tail, got ${out.length} chars`);
});

// --- HTML integration -------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(__dirname, '.tmp-polish-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const agents = [{ id: 'claude', name: 'Claude Code', version: '1.0' }];
const scenarios = [{ id: 'fix-bug', title: 'Fix the bug', category: 'debug', difficulty: 'easy' }];

function report(attempts) {
  return {
    runId: 'polish-run',
    startedAt: 0,
    version: '0.0.0',
    summary: summarize(attempts, agents, scenarios, 1),
    attempts,
    scenarios,
    config: { repeat: 1, suite: 'smoke' },
    environment: { os: 'test-os', node: 'v0' },
  };
}

function attemptWith(logFile) {
  return {
    agent: 'claude',
    scenario: 'fix-bug',
    rep: 1,
    startedAt: 0,
    passed: true,
    category: 'passed',
    durationMs: 1000,
    exitCode: 0,
    timedOut: false,
    tests: { total: 2, passed: 2, failed: 0, failures: [] },
    usage: { inputTokens: 10, outputTokens: 5, costUsd: null, turns: 1 },
    changes: { files: ['src/x.js'], insertions: 1, deletions: 0 },
    touchedTests: [],
    files: { log: logFile, diff: 'missing.diff' },
  };
}

test('report renders the readable message, escaped, and still links the raw log', () => {
  const logFile = 'logs/claude-fix-bug-r1.log';
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true });
  const message = 'All tests pass. Careful: <img src=x onerror=alert(1)> & "quoted".';
  fs.writeFileSync(path.join(tmp, logFile), JSON.stringify({ type: 'result', result: message }));

  const html = buildHtml(report([attemptWith(logFile)]), tmp);

  assert.ok(html.includes('All tests pass.'), 'readable message missing from the log tail');
  assert.ok(!html.includes('{"type":"result"'), 'raw JSON leaked into the log tail');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'message must be HTML-escaped');
  assert.ok(!html.includes('<img src=x'), 'unescaped markup leaked into the report');
  assert.ok(html.includes('&amp; &quot;quoted&quot;'), 'quotes/ampersands must be escaped');

  const link = pathToFileURL(path.resolve(tmp, logFile)).href;
  assert.ok(html.includes(`href="${link}"`), `raw log link missing (${link})`);
});

test('report shows "No output" for a missing log file', () => {
  const html = buildHtml(report([attemptWith('logs/absent.log')]), tmp);
  assert.ok(html.includes('No output.'), 'missing log should render the empty-state text');
});
