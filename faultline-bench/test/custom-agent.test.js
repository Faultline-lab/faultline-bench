'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCustomAgent, parsers } = require('../src/agents');

test('parseCustomAgent substitutes {prompt} wherever it appears', () => {
  const agent = parseCustomAgent('mycli=mycli -p {prompt} --yes');
  assert.equal(agent.id, 'mycli');
  assert.equal(agent.name, 'mycli (custom)');
  assert.equal(agent.custom, true);
  assert.deepEqual(agent.bin, ['mycli']);
  assert.deepEqual(agent.args('DO THE TASK'), ['-p', 'DO THE TASK', '--yes']);
  assert.equal(agent.parseUsage, parsers.parseGeneric);
});

test('parseCustomAgent appends {prompt} when the spec omits it', () => {
  const agent = parseCustomAgent('bare=bare --yes');
  assert.deepEqual(agent.args('PROMPT TEXT'), ['--yes', 'PROMPT TEXT']);
});

test('parseCustomAgent rejects a spec without =', () => {
  assert.throws(() => parseCustomAgent('mycli -p {prompt}'), /--agent-cmd must look like/);
  assert.throws(() => parseCustomAgent('=mycli -p {prompt}'), /--agent-cmd must look like/);
});

test('parseCustomAgent rejects a spec with no command', () => {
  assert.throws(() => parseCustomAgent('name='), /has no command/);
});
