'use strict';

// `node --test test/` resolves the directory to this file on Node 22+, while
// Node 18/20 search the directory for *.test.js. Loading every suite here keeps
// both working and means a new test file can never be skipped by accident.
const fs = require('node:fs');
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) require(`./${f}`);
