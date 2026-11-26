'use strict';

// `node --test test/` passes the directory through as one entry point on current
// Node, which resolves to this file. Requiring the suites here keeps the
// package.json test script working on old and new Node alike.
require('./parsers.test');
require('./harness.test');
require('./cli.test');
