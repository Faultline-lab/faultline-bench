'use strict';

// Node 24's `node --test <dir>` resolves the directory as a module, so load the suites here.
require('./runner.test.js');
require('./parsers.test.js');
require('./custom-agent.test.js');
require('./cli-args.test.js');
require('./scenarios.test.js');
require('./integration.test.js');
