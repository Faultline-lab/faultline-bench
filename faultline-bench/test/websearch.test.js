'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detectWebLookup } = require('../src/websearch');
const { AGENTS, PROMPT } = require('../src/agents');

test('detects Claude JSON tool_use blocks and their URLs', () => {
  const log = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', name: 'WebSearch', input: { query: 'lru cache node' } },
        { type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com/lru' } },
      ],
    },
  });
  const r = detectWebLookup(log);
  assert.strictEqual(r.detected, true);
  assert.ok(r.evidence.length <= 5);
  assert.ok(r.evidence.some((e) => /WebSearch/.test(e)), r.evidence.join(' | '));
  assert.ok(r.evidence.some((e) => /https:\/\/example\.com/.test(e)), r.evidence.join(' | '));
});

test('detects Codex JSONL web_search_call and curl', () => {
  const log = [
    '{"type":"item.started","item":{"type":"web_search_call","query":"node lru"}}',
    '{"type":"item.completed","item":{"type":"command_execution","command":"curl https://example.com/x"}}',
  ].join('\n');
  const r = detectWebLookup(log);
  assert.strictEqual(r.detected, true);
  assert.ok(r.evidence.some((e) => /web_search/i.test(e)), r.evidence.join(' | '));
  assert.ok(r.evidence.some((e) => /curl/.test(e)), r.evidence.join(' | '));
});

test('detects OpenCode JSONL webfetch tool and URL', () => {
  const log =
    '{"type":"tool_use","part":{"tool":"webfetch","state":{"status":"completed","input":{"url":"https://nodejs.org/api/"}}}}';
  const r = detectWebLookup(log);
  assert.strictEqual(r.detected, true);
  assert.ok(r.evidence.some((e) => /webfetch/i.test(e)), r.evidence.join(' | '));
  assert.ok(r.evidence.some((e) => /https:\/\/nodejs\.org/.test(e)), r.evidence.join(' | '));
});

test('detects plain-text download commands', () => {
  const r = detectWebLookup('Running: git clone https://github.com/x/y && wget http://example.com/a');
  assert.strictEqual(r.detected, true);
  assert.ok(r.evidence.some((e) => /git clone/.test(e)), r.evidence.join(' | '));
  assert.ok(r.evidence.some((e) => /wget/.test(e)), r.evidence.join(' | '));
  assert.ok(r.evidence.some((e) => /http:\/\/example\.com/.test(e)), r.evidence.join(' | '));
});

test('detects npm view and Invoke-WebRequest', () => {
  const r = detectWebLookup('Invoke-WebRequest -Uri https://example.com/file.zip -OutFile file.zip\nnpm view left-pad');
  assert.strictEqual(r.detected, true);
  assert.ok(r.evidence.some((e) => /Invoke-WebRequest/i.test(e)), r.evidence.join(' | '));
  assert.ok(r.evidence.some((e) => /npm view/.test(e)), r.evidence.join(' | '));
});

test('a URL quoted from a local file is not web use', () => {
  const log = [
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] },
    }),
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'See https://example.com/docs for details.' }] },
    }),
  ].join('\n');
  const r = detectWebLookup(log);
  assert.strictEqual(r.detected, false, r.evidence.join(' | '));
  assert.deepStrictEqual(r.evidence, []);
});

test('a URL printed in the final answer is not web use', () => {
  const log = [
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Done. Upstream lives at https://example.com/project.' }] },
    }),
    JSON.stringify({ type: 'result', result: 'All tests pass. See https://example.com/project for context.' }),
  ].join('\n');
  assert.strictEqual(detectWebLookup(log).detected, false);
  assert.strictEqual(detectWebLookup('Done. The file cites https://example.com/docs.').detected, false);
});

test('returns no evidence for ordinary local work', () => {
  const r = detectWebLookup('Updated src/cache.js and ran npm test.\nAll 12 tests pass. No network access needed.');
  assert.strictEqual(r.detected, false);
  assert.deepStrictEqual(r.evidence, []);
});

test('caps evidence at five entries', () => {
  const lines = Array.from({ length: 9 }, (_, i) => `curl https://example.com/${i}`).join('\n');
  const r = detectWebLookup(lines);
  assert.strictEqual(r.detected, true);
  assert.strictEqual(r.evidence.length, 5);
});

test('PROMPT does not name the tool or call itself an evaluation', () => {
  assert.doesNotMatch(PROMPT, /faultline|benchmark|evaluat/i);
  assert.match(PROMPT, /TASK\.md/);
  assert.match(PROMPT, /do not search the web/i);
});

test('every agent adapter declares whether web access is blocked', () => {
  for (const a of AGENTS) assert.strictEqual(typeof a.webBlocked, 'boolean', a.id);
});

test('claude blocks WebSearch and WebFetch', () => {
  const claude = AGENTS.find((a) => a.id === 'claude');
  const args = claude.args('p', {});
  const i = args.indexOf('--disallowedTools');
  assert.ok(i >= 0, args.join(' '));
  assert.deepStrictEqual(args.slice(i + 1, i + 3), ['WebSearch', 'WebFetch']);
  assert.strictEqual(claude.webBlocked, true);
});

test('codex adds no web flag its --help does not document', () => {
  const codex = AGENTS.find((a) => a.id === 'codex');
  const args = codex.args('p', {});
  assert.ok(!args.some((a) => /web_search/.test(a)), args.join(' '));
  assert.strictEqual(codex.webBlocked, false);
});

test('adapters without a verified flag report webBlocked false', () => {
  for (const id of ['codex', 'gemini', 'opencode', 'agy', 'cursor']) {
    const a = AGENTS.find((x) => x.id === id);
    assert.strictEqual(a.webBlocked, false, id);
  }
});
