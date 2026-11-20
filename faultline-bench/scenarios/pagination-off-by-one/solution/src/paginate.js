'use strict';

function paginate(items, page = 1, perPage = 10) {
  if (!Number.isInteger(page) || page < 1) throw new RangeError('page must be an integer >= 1');
  if (!Number.isInteger(perPage) || perPage < 1) throw new RangeError('perPage must be an integer >= 1');
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / perPage);
  const start = (page - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    page,
    perPage,
    totalItems,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

module.exports = { paginate };
