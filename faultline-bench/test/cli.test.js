'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { cli } = require('./helpers');

const SCENARIO_IDS = [
  'pagination-off-by-one',
  'duration-parser',
  'lru-cache',
  'invoice-rounding',
  'csv-parser',
  'event-emitter',
];

test('--version prints the package version', () => {
  const r = cli(['--version']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), require('../package.json').version);
});

test('list prints every scenario id', () => {
  const r = cli(['list']);
  assert.strictEqual(r.status, 0, r.stderr);
  for (const id of SCENARIO_IDS) assert.ok(r.stdout.includes(id), `missing scenario id: ${id}`);
});

test('an unknown option exits non-zero', () => {
  const r = cli(['--definitely-not-an-option']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /Unknown option/);
});
