'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execSync } = require('node:child_process');

// Guards the one-command install: the published package must contain every scenario's
// starting repo and sealed tests, and must not ship hidden tests or solutions as plain text.
test('npm package contains scenarios but not plain hidden tests', () => {
  const out = execSync('npm pack --dry-run --json --ignore-scripts=false', {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const files = JSON.parse(out.slice(out.indexOf('[')))[0].files.map((f) => f.path.split('\\').join('/'));
  for (const id of ['pagination-off-by-one', 'duration-parser', 'lru-cache', 'invoice-rounding', 'csv-parser', 'event-emitter']) {
    assert.ok(files.includes(`scenarios/${id}/scenario.json`), `${id} scenario.json`);
    assert.ok(files.includes(`scenarios/${id}/sealed.gz`), `${id} sealed.gz`);
    assert.ok(files.some((f) => f.startsWith(`scenarios/${id}/repo/src/`)), `${id} repo/src`);
  }
  assert.ok(!files.some((f) => /\/(hidden|solution)\//.test(f)), 'no plain hidden/ or solution/ files');
  assert.ok(files.includes('bin/faultline.js'));
});
