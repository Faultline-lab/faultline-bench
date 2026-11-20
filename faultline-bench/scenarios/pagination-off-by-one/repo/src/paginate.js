'use strict';

/**
 * Returns one page of items.
 * @param {Array} items
 * @param {number} page     1-based page number
 * @param {number} perPage  items per page
 */
function paginate(items, page = 1, perPage = 10) {
  const totalItems = items.length;
  const totalPages = Math.floor(totalItems / perPage) + 1;
  const start = page * perPage;
  const end = start + perPage;
  return {
    items: items.slice(start, end),
    page,
    perPage,
    totalItems,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 0,
  };
}

module.exports = { paginate };
