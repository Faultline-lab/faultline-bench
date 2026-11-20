'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsers } = require('../src/agents');

test('parseClaude sums cache tokens and reads total_cost_usd', () => {
  const stdout = JSON.stringify({
    type: 'result',
    is_error: false,
    num_turns: 3,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 50 },
  });
  assert.deepEqual(parsers.parseClaude(stdout), {
    inputTokens: 125,
    outputTokens: 50,
    costUsd: 0.0123,
    turns: 3,
    agentReportedError: false,
  });
});

test('parseCodex sums turn.completed usage without adding reasoning tokens twice', () => {
  const stdout = [
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 100, reasoning_output_tokens: 60 } },
    { type: 'item.completed', item: { type: 'message', text: 'done' } },
    { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 50, reasoning_output_tokens: 30 } },
  ]
    .map((ev) => JSON.stringify(ev))
    .join('\n');
  assert.deepEqual(parsers.parseCodex(stdout), {
    inputTokens: 15,
    outputTokens: 150,
    costUsd: null,
    turns: 2,
  });
});

test('parseOpenCode sums step_finish tokens, cache reads and cost', () => {
  const stdout = [
    { type: 'step_start', part: { id: 'a' } },
    { type: 'step_finish', part: { tokens: { input: 10, output: 5, cache: { read: 3 } }, cost: 0.01 } },
    { type: 'step_finish', part: { tokens: { input: 4, output: 6, cache: { read: 2 } }, cost: 0.02 } },
  ]
    .map((ev) => JSON.stringify(ev))
    .join('\n');
  assert.deepEqual(parsers.parseOpenCode(stdout), {
    inputTokens: 19,
    outputTokens: 11,
    costUsd: 0.03,
    turns: 2,
  });
});

test('parseAgy reads usage, cache_read_tokens and num_turns', () => {
  const stdout = JSON.stringify({
    status: 'SUCCESS',
    conversation_id: 'abc',
    num_turns: 2,
    usage: { input_tokens: 100, output_tokens: 40, cache_read_tokens: 25 },
  });
  assert.deepEqual(parsers.parseAgy(stdout), {
    inputTokens: 125,
    outputTokens: 40,
    costUsd: null,
    turns: 2,
    agentReportedError: false,
  });
});

test('parseGeneric returns nulls for text with no usage data', () => {
  assert.deepEqual(parsers.parseGeneric('All done! I fixed the bug.\nNo JSON here.'), {
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    turns: null,
  });
});
