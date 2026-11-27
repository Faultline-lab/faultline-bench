'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'faultline.js');
const CWD = path.join(__dirname, '..');
const SCENARIO_IDS = [
  'pagination-off-by-one',
  'duration-parser',
  'lru-cache',
  'invoice-rounding',
  'csv-parser',
  'event-emitter',
];

function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: CWD,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 60000,
  });
}

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
