'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInvoice } = require('../src/invoice');
const { formatMoney } = require('../src/money');

test('simple invoice', () => {
  const inv = createInvoice([{ description: 'Sticker', unitPrice: 0.29, quantity: 3 }]);
  assert.equal(inv.total, 87);
  assert.equal(inv.formatted.total, '$0.87');
});

test('formats with two decimals', () => {
  assert.equal(formatMoney(150), '$1.50');
});
