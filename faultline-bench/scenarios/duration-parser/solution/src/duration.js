'use strict';

const UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
const ORDER = ['d', 'h', 'm', 's', 'ms'];

function parseDuration(input) {
  if (typeof input !== 'string') throw new TypeError('input must be a string');
  const text = input.trim().toLowerCase();
  if (!text) throw new RangeError('empty duration');
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*/gy;
  let total = 0;
  let pos = 0;
  const seen = new Set();
  let m;
  while (pos < text.length && (m = re.exec(text))) {
    if (seen.has(m[2])) throw new RangeError(`unit "${m[2]}" repeated`);
    seen.add(m[2]);
    total += Number(m[1]) * UNITS[m[2]];
    pos = re.lastIndex;
  }
  if (pos !== text.length || !seen.size) throw new RangeError(`invalid duration: ${input}`);
  return Math.round(total);
}

function formatDuration(ms) {
  if (typeof ms !== 'number') throw new TypeError('ms must be a number');
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError('ms must be a finite, non-negative number');
  let rest = Math.round(ms);
  if (rest === 0) return '0ms';
  const parts = [];
  for (const u of ORDER) {
    const n = Math.floor(rest / UNITS[u]);
    if (n) parts.push(`${n}${u}`);
    rest -= n * UNITS[u];
  }
  return parts.join(' ');
}

module.exports = { parseDuration, formatDuration };
