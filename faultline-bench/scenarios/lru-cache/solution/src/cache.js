'use strict';

class Cache {
  constructor(options = {}) {
    const { maxSize = Infinity, onEvict } = options;
    if (maxSize !== Infinity && !(Number.isInteger(maxSize) && maxSize >= 1)) {
      throw new RangeError('maxSize must be Infinity or an integer >= 1');
    }
    this.maxSize = maxSize;
    this.onEvict = typeof onEvict === 'function' ? onEvict : null;
    this.store = new Map();
  }

  get(key) {
    if (!this.store.has(key)) return undefined;
    const value = this.store.get(key);
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.maxSize) {
      const [oldKey, oldValue] = this.store.entries().next().value;
      this.store.delete(oldKey);
      if (this.onEvict) this.onEvict(oldKey, oldValue);
    }
    return this;
  }

  has(key) {
    return this.store.has(key);
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  keys() {
    return [...this.store.keys()];
  }

  get size() {
    return this.store.size;
  }
}

module.exports = { Cache };
