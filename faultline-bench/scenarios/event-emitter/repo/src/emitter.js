'use strict';

class Emitter {
  constructor() {
    this.listeners = {};
  }

  on(event, listener) {
    (this.listeners[event] = this.listeners[event] || []).push(listener);
    return this;
  }

  emit(event, ...args) {
    const listeners = this.listeners[event];
    if (!listeners) return false;
    for (let i = 0; i < listeners.length; i++) listeners[i](...args);
    return true;
  }
}

module.exports = { Emitter };
