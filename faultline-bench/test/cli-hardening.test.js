'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'faultline.js');
const CWD = path.join(__dirname, '..');

// spawnSync uses pipes, so stdin and stdout are never TTYs here.
function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: CWD,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 120000,
  });
}

test('a value option followed by another flag does not swallow it', () => {
  const r = cli(['run', '--agents', '--yes']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /faultline: --agents needs a value/);
});

test('a value option at the end needs a value', () => {
  for (const opt of ['--suite', '--workdir', '--out']) {
    const r = cli(['run', opt]);
    assert.strictEqual(r.status, 1, opt);
    assert.match(r.stderr, new RegExp(`faultline: ${opt} needs a value`));
  }
});

test('an unknown short flag is reported as an option', () => {
  const r = cli(['-x']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Unknown option -x/);
  assert.doesNotMatch(r.stderr, /Unknown command/);
});

test('without a TTY, real agents refuse to start unless --yes is given', () => {
  const r = cli(['run', '--agent-cmd', 'fake=node -e 0 {prompt}', '--agents', 'fake', '--scenarios', 'pagination-off-by-one']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--yes/);
  assert.doesNotMatch(r.stdout, /tests\s+\S+\s+\[1\/1\]/, 'an attempt ran');
});

test('without a TTY, oracle still runs without --yes', () => {
  // Scratch dir next to the tests, not the system temp folder.
  const tmp = fs.mkdtempSync(path.join(__dirname, '.tmp-hardening-'));
  const out = path.join(tmp, 'out');
  try {
    const r = cli(['run', '--agents', 'oracle', '--scenarios', 'pagination-off-by-one', '--out', out, '--workdir', tmp, '--no-open']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.readdirSync(out).length, 'no report written');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('help documents --workdir', () => {
  const r = cli(['--help']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /--workdir <dir>/);
});
