'use strict';

class Emitter {
  constructor() {
    this.listeners = {};
  }

  on(event, listener) {
    (this.listeners[event] = this.listeners[event] || []).push({ fn: listener, once: false });
    return this;
  }

  once(event, listener) {
    (this.listeners[event] = this.listeners[event] || []).push({ fn: listener, once: true });
    return this;
  }

  off(event, listener) {
    const list = this.listeners[event];
    if (!list) return this;
    const i = list.findIndex((entry) => entry.fn === listener);
    if (i !== -1) list.splice(i, 1);
    if (!list.length) delete this.listeners[event];
    return this;
  }

  listenerCount(event) {
    return (this.listeners[event] || []).length;
  }

  emit(event, ...args) {
    const list = this.listeners[event];
    if (!list || !list.length) {
      if (event === 'error') throw args[0] instanceof Error ? args[0] : new Error(`Unhandled error: ${String(args[0])}`);
      return false;
    }
    const snapshot = [...list];
    let firstError = null;
    for (const entry of snapshot) {
      if (entry.once) {
        const current = this.listeners[event];
        const i = current ? current.indexOf(entry) : -1;
        if (i !== -1) {
          current.splice(i, 1);
          if (!current.length) delete this.listeners[event];
        }
      }
      try {
        entry.fn.apply(this, args);
      } catch (err) {
        if (!firstError) firstError = { err };
      }
    }
    if (firstError) throw firstError.err;
    return true;
  }
}

module.exports = { Emitter };
