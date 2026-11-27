#!/usr/bin/env node
'use strict';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 19)) {
  console.error(`Faultline Bench needs Node.js 18.19 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}

require('../src/cli').main(process.argv.slice(2)).then(
  (code) => process.exit(code || 0),
  (err) => {
    console.error(`\nfaultline: ${err && err.message ? err.message : err}`);
    if (process.env.FAULTLINE_DEBUG) console.error(err);
    process.exit(1);
  }
);
