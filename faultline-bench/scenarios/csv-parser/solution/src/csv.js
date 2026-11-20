'use strict';

function parseCSV(text, options = {}) {
  const delimiter = options.delimiter || ',';
  const rows = [];
  if (text === '') return rows;
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  let quotedStart = -1;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      quotedStart = i;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (inQuotes) throw new SyntaxError(`Unterminated quoted field starting at index ${quotedStart}`);
  const endsWithBreak = text.endsWith('\n');
  if (!endsWithBreak) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

module.exports = { parseCSV };
