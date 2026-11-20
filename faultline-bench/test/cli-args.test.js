'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/cli');

test('parseArgs reads flags and --key=value pairs', () => {
  const opts = parseArgs(['run', '--agents', 'claude,codex', '--suite=full', '-y', '--no-open']);
  assert.deepEqual(opts._, ['run']);
  assert.equal(opts.agents, 'claude,codex');
  assert.equal(opts.suite, 'full');
  assert.equal(opts.yes, true);
  assert.equal(opts.open, false);
});

test('parseArgs collects repeatable --model values', () => {
  const opts = parseArgs(['run', '--model', 'claude=sonnet', '--model=codex=gpt-5']);
  assert.deepEqual(opts.model, ['claude=sonnet', 'codex=gpt-5']);
});

test('parseArgs collects repeatable --agent-cmd values', () => {
  const opts = parseArgs(['run', '--agent-cmd', 'a=a -p {prompt}', '--agent-cmd=b=b -p {prompt}']);
  assert.deepEqual(opts.agentCmd, ['a=a -p {prompt}', 'b=b -p {prompt}']);
});

test('parseArgs defaults open=true, yes=false and empty lists', () => {
  const opts = parseArgs([]);
  assert.deepEqual(opts.model, []);
  assert.deepEqual(opts.agentCmd, []);
  assert.equal(opts.open, true);
  assert.equal(opts.yes, false);
});

test('parseArgs rejects an unknown flag', () => {
  assert.throws(() => parseArgs(['run', '--nope', 'x']), /Unknown option --nope/);
});

test('parseArgs rejects a flag missing its value', () => {
  assert.throws(() => parseArgs(['run', '--agents']), /--agents needs a value/);
});
