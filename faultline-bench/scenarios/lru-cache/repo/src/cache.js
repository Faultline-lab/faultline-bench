'use strict';

class Cache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    this.store.set(key, value);
    return this;
  }

  has(key) {
    return this.store.has(key);
  }

  get size() {
    return this.store.size;
  }
}

module.exports = { Cache };
