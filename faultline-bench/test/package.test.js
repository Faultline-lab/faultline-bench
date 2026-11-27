'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');

test('package.json version matches the top released CHANGELOG heading', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const top = changelog.match(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/m);
  assert.ok(top, 'no released version heading in CHANGELOG.md');
  assert.strictEqual(top[1], pkg.version);
});

test('every entry in files exists', () => {
  for (const entry of pkg.files) {
    assert.ok(fs.existsSync(path.join(root, entry)), `missing: ${entry}`);
  }
});

test('bin targets exist and start with a node shebang', () => {
  for (const [name, target] of Object.entries(pkg.bin)) {
    const file = path.join(root, target);
    assert.ok(fs.existsSync(file), `${name}: missing ${target}`);
    const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/, 1)[0];
    assert.strictEqual(firstLine, '#!/usr/bin/env node', `${name}: bad shebang in ${target}`);
  }
});

test('package has no dependencies', () => {
  assert.strictEqual(pkg.dependencies, undefined);
});
