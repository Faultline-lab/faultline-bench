'use strict';

// Scans an agent's raw output (JSON lines or plain text) for signs it looked
// something up on the web. Only URLs inside tool-call inputs or shell commands
// count; a URL quoted from a local file or printed in the final answer does not.
const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/gi;
const CMD_RE = /\b(?:curl|wget|Invoke-WebRequest|git\s+clone|npm\s+view)\b/gi;
const WEB_TOOL_RE = /(?:WebSearch|WebFetch|web_?search|web_?fetch|fetch_url|fetch_webpage|browser(?:_use)?)/i;
const MAX_EVIDENCE = 5;

function push(out, s) {
  const t = String(s).trim().slice(0, 120);
  if (t && !out.includes(t) && out.length < MAX_EVIDENCE) out.push(t);
}

function scanStrings(value, out) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(URL_RE)) push(out, m[0]);
    for (const m of value.matchAll(CMD_RE)) push(out, m[0]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => scanStrings(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => scanStrings(v, out));
  }
}

// Tool-call shapes: {type:'tool_use'|'function_call'|'web_search_call'|'command_execution'|...,
// name|tool, input|arguments|command}. Only these carry what the agent actually ran.
function isToolCall(o) {
  if (typeof o.tool === 'string' || (typeof o.name === 'string' && (o.input || o.arguments))) return true;
  return typeof o.type === 'string' && /(?:^|_)(?:tool_use|tool_call|function_call|call|execution)$/i.test(o.type);
}

function scanJson(value, out) {
  if (Array.isArray(value)) return value.forEach((v) => scanJson(v, out));
  if (!value || typeof value !== 'object') return;
  for (const k of ['name', 'tool', 'type']) {
    if (typeof value[k] === 'string' && WEB_TOOL_RE.test(value[k])) push(out, value[k]);
  }
  if (isToolCall(value)) scanStrings(value.input ?? value.arguments ?? value.command ?? value, out);
  Object.values(value).forEach((v) => scanJson(v, out));
}

// Plain terminal output: a URL only counts when it sits on a line that runs a download command.
function scanPlain(line, out) {
  const cmds = [...line.matchAll(CMD_RE)];
  if (!cmds.length) return;
  cmds.forEach((m) => push(out, m[0]));
  for (const m of line.matchAll(URL_RE)) push(out, m[0]);
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function detectWebLookup(logText) {
  const text = typeof logText === 'string' ? logText : '';
  const evidence = [];
  const whole = tryJson(text.trim());
  if (whole) {
    scanJson(whole, evidence);
  } else {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const json = t.startsWith('{') || t.startsWith('[') ? tryJson(t) : null;
      if (json) scanJson(json, evidence);
      else scanPlain(t, evidence);
    }
  }
  return { detected: evidence.length > 0, evidence };
}

module.exports = { detectWebLookup };
