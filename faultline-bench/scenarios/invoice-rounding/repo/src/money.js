'use strict';

function toCents(amount) {
  return Math.floor(amount * 100);
}

function formatMoney(cents) {
  return '$' + cents / 100;
}

module.exports = { toCents, formatMoney };
