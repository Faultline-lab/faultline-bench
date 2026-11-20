'use strict';

function parseCSV(text, options = {}) {
  const delimiter = options.delimiter || ',';
  return text.split('\n').map((line) => line.split(delimiter));
}

module.exports = { parseCSV };
