'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Emitter } = require('../src/emitter');

test('on and emit with arguments', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', (a, b) => seen.push(a + b));
  assert.equal(e.emit('x', 1, 2), true);
  assert.deepEqual(seen, [3]);
});

test('emit returns false without listeners', () => {
  assert.equal(new Emitter().emit('nothing'), false);
});

test('listeners run in order with this = emitter', () => {
  const e = new Emitter();
  const order = [];
  e.on('x', function () {
    order.push(this === e ? 'a' : 'wrong-this');
  });
  e.on('x', () => order.push('b'));
  e.emit('x');
  assert.deepEqual(order, ['a', 'b']);
});

test('on, once and off are chainable', () => {
  const e = new Emitter();
  const f = () => {};
  assert.equal(e.on('x', f), e);
  assert.equal(e.once('x', f), e);
  assert.equal(e.off('x', f), e);
});

test('once runs one time and is removed', () => {
  const e = new Emitter();
  let n = 0;
  e.once('x', () => n++);
  assert.equal(e.listenerCount('x'), 1);
  e.emit('x');
  e.emit('x');
  assert.equal(n, 1);
  assert.equal(e.listenerCount('x'), 0);
});

test('off removes the earliest registration only', () => {
  const e = new Emitter();
  let n = 0;
  const f = () => n++;
  e.on('x', f).on('x', f);
  e.off('x', f);
  assert.equal(e.listenerCount('x'), 1);
  e.emit('x');
  assert.equal(n, 1);
});

test('off with the original function removes a once listener', () => {
  const e = new Emitter();
  let n = 0;
  const f = () => n++;
  e.once('x', f);
  e.off('x', f);
  e.emit('x');
  assert.equal(n, 0);
  assert.equal(e.listenerCount('x'), 0);
});

test('off of an unknown listener is a no-op', () => {
  const e = new Emitter();
  e.on('x', () => {});
  e.off('x', () => {});
  e.off('nope', () => {});
  assert.equal(e.listenerCount('x'), 1);
});

test('listeners added during emit are not called in that emit', () => {
  const e = new Emitter();
  const calls = [];
  e.on('x', () => {
    calls.push('first');
    e.on('x', () => calls.push('late'));
  });
  e.emit('x');
  assert.deepEqual(calls, ['first']);
  calls.length = 0;
  e.emit('x');
  assert.deepEqual(calls, ['first', 'late']);
});

test('listeners removed during emit still run in that emit', () => {
  const e = new Emitter();
  const calls = [];
  const second = () => calls.push('second');
  e.on('x', () => {
    calls.push('first');
    e.off('x', second);
  });
  e.on('x', second);
  e.emit('x');
  assert.deepEqual(calls, ['first', 'second']);
  calls.length = 0;
  e.emit('x');
  assert.deepEqual(calls, ['first']);
});

test('a throwing listener does not stop the others; first error is rethrown', () => {
  const e = new Emitter();
  const calls = [];
  e.on('x', () => {
    calls.push(1);
    throw new Error('one');
  });
  e.on('x', () => {
    calls.push(2);
    throw new Error('two');
  });
  e.on('x', () => calls.push(3));
  assert.throws(() => e.emit('x'), { message: 'one' });
  assert.deepEqual(calls, [1, 2, 3]);
});

test('a once listener that throws is still removed', () => {
  const e = new Emitter();
  e.once('x', () => {
    throw new Error('boom');
  });
  assert.throws(() => e.emit('x'));
  assert.equal(e.listenerCount('x'), 0);
  assert.equal(e.emit('x'), false);
});

test('unhandled error event throws', () => {
  const e = new Emitter();
  const err = new Error('bad');
  assert.throws(() => e.emit('error', err), (thrown) => thrown === err);
  assert.throws(() => e.emit('error', 'just a string'), Error);
});

test('handled error event does not throw', () => {
  const e = new Emitter();
  let got = null;
  e.on('error', (er) => (got = er));
  const err = new Error('bad');
  assert.equal(e.emit('error', err), true);
  assert.equal(got, err);
});

test('listenerCount', () => {
  const e = new Emitter();
  assert.equal(e.listenerCount('x'), 0);
  e.on('x', () => {}).once('x', () => {});
  assert.equal(e.listenerCount('x'), 2);
});
