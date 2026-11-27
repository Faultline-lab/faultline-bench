'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'faultline.js');

// spawnSync uses pipes, so stdin and stdout are never TTYs here.
function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 120000,
  });
}

module.exports = { cli };
