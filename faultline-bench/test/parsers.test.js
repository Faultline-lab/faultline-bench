'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parsers } = require('../src/agents');
const { parseTap, classify } = require('../src/runner');

const { parseClaude, parseCodex, parseGemini, parseOpenCode, parseAgy, parseGeneric } = parsers;

test('parseClaude reads a single JSON result', () => {
  const stdout = JSON.stringify({
    usage: { input_tokens: 10, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 5 },
    total_cost_usd: 0.12,
    num_turns: 4,
    is_error: false,
  });
  assert.deepStrictEqual(parseClaude(stdout), {
    inputTokens: 15,
    outputTokens: 5,
    costUsd: 0.12,
    turns: 4,
    agentReportedError: false,
  });
});

test('parseClaude finds the result line in JSONL output', () => {
  const stdout = [
    '{"type":"message","text":"working"}',
    '{"type":"result","usage":{"input_tokens":7,"output_tokens":3},"total_cost_usd":0.01,"num_turns":1,"is_error":true}',
  ].join('\n');
  const u = parseClaude(stdout);
  assert.strictEqual(u.inputTokens, 7);
  assert.strictEqual(u.outputTokens, 3);
  assert.strictEqual(u.costUsd, 0.01);
  assert.strictEqual(u.turns, 1);
  assert.strictEqual(u.agentReportedError, true);
});

test('parseCodex sums turn.completed usage', () => {
  const stdout = [
    '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}',
    '{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":10}}',
  ].join('\n');
  assert.deepStrictEqual(parseCodex(stdout), { inputTokens: 150, outputTokens: 30, costUsd: null, turns: 2 });
});

test('parseCodex falls back to generic when no turn.completed', () => {
  const stdout = ['{"input_tokens":9,"output_tokens":4}', '{"input_tokens":1,"output_tokens":2}'].join('\n');
  assert.deepStrictEqual(parseCodex(stdout), { inputTokens: 10, outputTokens: 6, costUsd: null, turns: null });
});

test('parseGemini sums per-model stats', () => {
  const stdout = JSON.stringify({
    stats: { models: { a: { tokens: { prompt: 10, candidates: 5, thoughts: 3 } }, b: { tokens: { input: 1, output: 2 } } } },
  });
  assert.deepStrictEqual(parseGemini(stdout), { inputTokens: 11, outputTokens: 10, costUsd: null, turns: null });
});

test('parseOpenCode sums step_finish tokens and cost', () => {
  const stdout = [
    '{"type":"step_finish","part":{"tokens":{"input":10,"cache":{"read":2},"output":5},"cost":0.01}}',
    '{"type":"step_finish","part":{"tokens":{"input":4,"output":1},"cost":0.02}}',
  ].join('\n');
  assert.deepStrictEqual(parseOpenCode(stdout), { inputTokens: 16, outputTokens: 6, costUsd: 0.03, turns: 2 });
});

test('parseAgy reads the usage block', () => {
  const stdout = JSON.stringify({
    conversation_id: 'abc',
    usage: { input_tokens: 10, cache_read_tokens: 2, output_tokens: 5 },
    num_turns: 2,
    status: 'SUCCESS',
  });
  assert.deepStrictEqual(parseAgy(stdout), {
    inputTokens: 12,
    outputTokens: 5,
    costUsd: null,
    turns: 2,
    agentReportedError: false,
  });
});

test('parseAgy flags a non-SUCCESS status', () => {
  const stdout = '{"conversation_id":"abc","usage":{"input_tokens":1},"status":"ERROR"}';
  assert.strictEqual(parseAgy(stdout).agentReportedError, true);
});

test('parseGeneric walks nested token and cost fields', () => {
  const stdout = [
    '{"result":{"tokens":{"input":10,"output":4,"reasoning":1,"cache":{"read":2}}}}',
    '{"meta":{"total_cost_usd":0.5}}',
  ].join('\n');
  assert.deepStrictEqual(parseGeneric(stdout), { inputTokens: 12, outputTokens: 5, costUsd: 0.5, turns: null });
});

test('parseGeneric reads input_tokens/output_tokens and returns nulls for plain text', () => {
  const stdout = ['{"usage":{"input_tokens":3,"output_tokens":2}}', '{"input_tokens":1}'].join('\n');
  assert.deepStrictEqual(parseGeneric(stdout), { inputTokens: 4, outputTokens: 2, costUsd: null, turns: null });
  assert.deepStrictEqual(parseGeneric('no usage here'), { inputTokens: null, outputTokens: null, costUsd: null, turns: null });
});

test('parseTap extracts counts and failure names', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - first',
    'not ok 2 - second thing',
    'ok 3 - third',
    '# tests 3',
    '# pass 2',
    '# fail 1',
  ].join('\n');
  assert.deepStrictEqual(parseTap(tap), { total: 3, passed: 2, failed: 1, failures: ['second thing'], ran: true });
});

test('parseTap reports ran=false when no summary is present', () => {
  const tap = parseTap('garbage output');
  assert.strictEqual(tap.ran, false);
  assert.strictEqual(tap.total, 0);
});

test('classify covers each category', () => {
  const ok = { agentResult: { timedOut: false, code: 0 }, tests: { ran: true, total: 2, passed: 2, failed: 0 }, changes: { files: ['a.js'] } };
  assert.strictEqual(classify(ok), 'passed');

  const timeout = { agentResult: { timedOut: true, code: null }, tests: { ran: false, total: 0, passed: 0, failed: 0 }, changes: { files: [] } };
  assert.strictEqual(classify(timeout), 'timeout');

  const noChanges = { agentResult: { timedOut: false, code: 0 }, tests: { ran: true, total: 2, passed: 0, failed: 2 }, changes: { files: [] } };
  assert.strictEqual(classify(noChanges), 'no_changes');

  const crashed = { agentResult: { timedOut: false, code: 1 }, tests: { ran: false, total: 0, passed: 0, failed: 0 }, changes: { files: [] } };
  assert.strictEqual(classify(crashed), 'agent_error');

  const broken = { agentResult: { timedOut: false, code: 0 }, tests: { ran: false, total: 0, passed: 0, failed: 0 }, changes: { files: ['a.js'] } };
  assert.strictEqual(classify(broken), 'broken_code');

  const failed = { agentResult: { timedOut: false, code: 0 }, tests: { ran: true, total: 2, passed: 1, failed: 1 }, changes: { files: ['a.js'] } };
  assert.strictEqual(classify(failed), 'tests_failed');
});
