'use strict';

// Scans an agent's raw output (JSON lines or plain text) for signs it looked
// something up on the web. Pattern scan, not a JSON parser.
const TOOL_RE = /(?:WebSearch|WebFetch|web_?search|web_?fetch|fetch_url|fetch_webpage|browser(?:_use)?)/gi;
const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/gi;
const CMD_RE = /\b(?:curl|wget|Invoke-WebRequest|git\s+clone)\b/gi;
const MAX_EVIDENCE = 5;

function collect(text, re, out) {
  for (const m of text.matchAll(re)) {
    if (out.length >= MAX_EVIDENCE) return;
    const s = m[0].trim().slice(0, 120);
    if (s && !out.includes(s)) out.push(s);
  }
}

function detectWebLookup(logText) {
  const text = typeof logText === 'string' ? logText : '';
  const evidence = [];
  collect(text, TOOL_RE, evidence);
  collect(text, URL_RE, evidence);
  collect(text, CMD_RE, evidence);
  return { detected: evidence.length > 0, evidence };
}

module.exports = { detectWebLookup };
