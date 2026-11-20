'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTap, classify } = require('../src/runner');

const TAP = `TAP version 13
# Subtest: adds numbers
ok 1 - adds numbers
# Subtest: parses quoted fields
not ok 2 - parses quoted fields
  ---
  error: 'expected 2 rows'
  ...
# Subtest: handles empty input
ok 3 - handles empty input
# tests 3
# pass 2
# fail 1
# duration_ms 12.3
`;

test('parseTap reads totals and failures from a full TAP report', () => {
  assert.deepEqual(parseTap(TAP), {
    total: 3,
    passed: 2,
    failed: 1,
    failures: ['parses quoted fields'],
    ran: true,
  });
});

test('parseTap reports ran=false when summary lines are missing', () => {
  assert.deepEqual(parseTap('ok 1 - adds numbers\n'), {
    total: 0,
    passed: 0,
    failed: 0,
    failures: [],
    ran: false,
  });
});

test('parseTap caps the failure list at 20', () => {
  const lines = Array.from({ length: 25 }, (_, i) => `not ok ${i + 1} - test ${i + 1}`);
  const parsed = parseTap(lines.join('\n'));
  assert.equal(parsed.failures.length, 20);
  assert.deepEqual(parsed.failures.slice(0, 2), ['test 1', 'test 2']);
});

const tests = (over) => ({ ran: true, total: 4, passed: 4, failed: 0, timedOut: false, ...over });
const agentResult = (over) => ({ timedOut: false, code: 0, ...over });
const changes = (files) => ({ files });

test('classify: passed when every test passes', () => {
  assert.equal(classify({ agentResult: agentResult(), tests: tests(), changes: changes(['src/a.js']) }), 'passed');
});

test('classify: timeout when the agent was killed', () => {
  assert.equal(
    classify({ agentResult: agentResult({ timedOut: true }), tests: tests({ ran: false, total: 0, passed: 0 }), changes: changes([]) }),
    'timeout'
  );
});

test('classify: agent_error when it changed nothing and exited non-zero', () => {
  assert.equal(
    classify({ agentResult: agentResult({ code: 1 }), tests: tests({ ran: false, total: 0, passed: 0 }), changes: changes([]) }),
    'agent_error'
  );
});

test('classify: no_changes when it exited cleanly but changed nothing', () => {
  assert.equal(
    classify({ agentResult: agentResult(), tests: tests({ ran: false, total: 0, passed: 0 }), changes: changes([]) }),
    'no_changes'
  );
});

test('classify: broken_code when tests did not run or crashed', () => {
  const notRun = tests({ ran: false, total: 0, passed: 0 });
  assert.equal(classify({ agentResult: agentResult(), tests: notRun, changes: changes(['src/a.js']) }), 'broken_code');
  assert.equal(
    classify({ agentResult: agentResult(), tests: tests({ passed: 0, failed: 4, timedOut: true }), changes: changes(['src/a.js']) }),
    'broken_code'
  );
});

test('classify: tests_failed when tests ran and some failed', () => {
  assert.equal(
    classify({ agentResult: agentResult(), tests: tests({ passed: 3, failed: 1 }), changes: changes(['src/a.js']) }),
    'tests_failed'
  );
});
