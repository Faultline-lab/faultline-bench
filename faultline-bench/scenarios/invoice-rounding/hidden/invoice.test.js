'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInvoice } = require('../src/invoice');
const { toCents, formatMoney } = require('../src/money');

test('toCents rounds to the nearest cent', () => {
  assert.equal(toCents(0.29), 29);
  assert.equal(toCents(1.1), 110);
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents(0.07), 7);
  assert.equal(toCents(4.35), 435);
});

test('formatMoney', () => {
  assert.equal(formatMoney(150), '$1.50');
  assert.equal(formatMoney(123450), '$1,234.50');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(-305), '-$3.05');
  assert.equal(formatMoney(100000000), '$1,000,000.00');
});

test('line totals use cents', () => {
  const inv = createInvoice([{ description: 'Sticker', unitPrice: 0.29, quantity: 3 }]);
  assert.deepEqual(
    { subtotal: inv.subtotal, discount: inv.discount, tax: inv.tax, total: inv.total },
    { subtotal: 87, discount: 0, tax: 0, total: 87 }
  );
  assert.equal(inv.formatted.total, '$0.87');
});

test('discount and tax', () => {
  const inv = createInvoice(
    [
      { description: 'Widget', unitPrice: 19.99, quantity: 3 },
      { description: 'Cable', unitPrice: 5.01, quantity: 1 },
    ],
    { discountPercent: 10, taxRate: 0.0825 }
  );
  assert.equal(inv.subtotal, 6498);
  assert.equal(inv.discount, 650);
  assert.equal(inv.tax, 482);
  assert.equal(inv.total, 6330);
  assert.deepEqual(inv.formatted, { subtotal: '$64.98', discount: '$6.50', tax: '$4.82', total: '$63.30' });
});

test('tax rounds half up', () => {
  const inv = createInvoice([{ description: 'Book', unitPrice: 10, quantity: 1 }], { taxRate: 0.0825 });
  assert.equal(inv.tax, 83);
  assert.equal(inv.total, 1083);
});

test('discount rounds half up', () => {
  const inv = createInvoice([{ description: 'Pen', unitPrice: 1.05, quantity: 10 }], { discountPercent: 5 });
  assert.equal(inv.subtotal, 1050);
  assert.equal(inv.discount, 53);
  assert.equal(inv.total, 997);
});

test('many small items do not drift', () => {
  const lines = Array.from({ length: 100 }, (_, i) => ({ description: `item ${i}`, unitPrice: 0.1, quantity: 1 }));
  const inv = createInvoice(lines, { taxRate: 0.05 });
  assert.equal(inv.subtotal, 1000);
  assert.equal(inv.tax, 50);
  assert.equal(inv.total, 1050);
});

test('total is exactly subtotal - discount + tax', () => {
  const inv = createInvoice(
    [
      { description: 'a', unitPrice: 3.33, quantity: 7 },
      { description: 'b', unitPrice: 12.49, quantity: 2 },
    ],
    { discountPercent: 15, taxRate: 0.07 }
  );
  assert.equal(inv.total, inv.subtotal - inv.discount + inv.tax);
  for (const k of ['subtotal', 'discount', 'tax', 'total']) assert.ok(Number.isInteger(inv[k]), `${k} is an integer`);
});

test('empty invoice', () => {
  const inv = createInvoice([]);
  assert.equal(inv.total, 0);
  assert.equal(inv.formatted.total, '$0.00');
});

test('validation', () => {
  const line = { description: 'x', unitPrice: 1, quantity: 1 };
  assert.throws(() => createInvoice([{ ...line, quantity: 0 }]), RangeError);
  assert.throws(() => createInvoice([{ ...line, quantity: 1.5 }]), RangeError);
  assert.throws(() => createInvoice([line], { discountPercent: 101 }), RangeError);
  assert.throws(() => createInvoice([line], { discountPercent: -1 }), RangeError);
  assert.throws(() => createInvoice([line], { taxRate: -0.1 }), RangeError);
});
