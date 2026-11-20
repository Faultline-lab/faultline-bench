'use strict';

const { toCents, formatMoney } = require('./money');

// Exact decimal -> BigInt fraction, so 0.0825 really is 825/10000.
function toFraction(n) {
  const s = Number(n).toFixed(10).replace(/\.?0+$/, '');
  const [whole, frac = ''] = s.split('.');
  return { num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) };
}

// Round half up of cents * (num / den) / divisor, for non-negative values.
function scaleRound(cents, factor, divisor = 1n) {
  const { num, den } = toFraction(factor);
  const a = BigInt(cents) * num;
  const d = den * divisor;
  return Number((2n * a + d) / (2n * d));
}

function createInvoice(lines, options = {}) {
  const { discountPercent = 0, taxRate = 0 } = options;
  if (!(discountPercent >= 0 && discountPercent <= 100)) throw new RangeError('discountPercent must be 0..100');
  if (!(taxRate >= 0)) throw new RangeError('taxRate must be >= 0');
  let subtotal = 0;
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new RangeError('quantity must be an integer >= 1');
    subtotal += toCents(line.unitPrice) * line.quantity;
  }
  const discount = scaleRound(subtotal, discountPercent, 100n);
  const tax = scaleRound(subtotal - discount, taxRate);
  const total = subtotal - discount + tax;
  const result = { subtotal, discount, tax, total };
  result.formatted = {
    subtotal: formatMoney(subtotal),
    discount: formatMoney(discount),
    tax: formatMoney(tax),
    total: formatMoney(total),
  };
  return result;
}

module.exports = { createInvoice };
