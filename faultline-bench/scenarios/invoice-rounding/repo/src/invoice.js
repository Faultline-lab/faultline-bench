'use strict';

const { toCents, formatMoney } = require('./money');

function createInvoice(lines, options = {}) {
  const { discountPercent = 0, taxRate = 0 } = options;
  let subtotal = 0;
  for (const line of lines) subtotal += line.unitPrice * line.quantity;
  const discount = subtotal * (discountPercent / 100);
  const tax = (subtotal - discount) * taxRate;
  const total = subtotal - discount + tax;

  const result = {
    subtotal: toCents(subtotal),
    discount: toCents(discount),
    tax: toCents(tax),
    total: toCents(total),
  };
  result.formatted = {
    subtotal: formatMoney(result.subtotal),
    discount: formatMoney(result.discount),
    tax: formatMoney(result.tax),
    total: formatMoney(result.total),
  };
  return result;
}

module.exports = { createInvoice };
