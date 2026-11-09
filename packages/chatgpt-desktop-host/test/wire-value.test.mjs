import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { decodeWireValue, encodeWireValue, WIRE_DEFAULT_LIMITS } from '../src/wire-value.mjs';

const roundTrip = (value, limits) => decodeWireValue(encodeWireValue(value, limits), limits);
const envelope = (root, nodes) => JSON.stringify({
  format: 'chatgpt-apphost-wire',
  version: 1,
  root,
  nodes,
});

test('round trips the primitive values JSON silently changes', () => {
  const value = [undefined, null, true, false, 1.25, -0, NaN, Infinity, -Infinity, 12345678901234567890n, '中文😀\ud800'];
  const result = roundTrip(value);
  assert.equal(result[0], undefined);
  assert.equal(result[1], null);
  assert.deepEqual(result.slice(2, 5), [true, false, 1.25]);
  assert.ok(Object.is(result[5], -0));
  assert.ok(Number.isNaN(result[6]));
  assert.equal(result[7], Infinity);
  assert.equal(result[8], -Infinity);
  assert.equal(result[9], 12345678901234567890n);
  assert.equal(result[10], value[10]);
});

test('preserves cycles, shared references, sparse arrays, and null-prototype objects', () => {
  const shared = Object.assign(Object.create(null), { answer: 42 });
  const input = { left: shared, right: shared, list: Array(4) };
  input.self = input;
  input.list[1] = shared;
  input.list.extra = 'metadata';
  const result = roundTrip(input);
  assert.equal(result.self, result);
  assert.equal(result.left, result.right);
  assert.equal(result.list[1], result.left);
  assert.equal(Object.getPrototypeOf(result.left), null);
  assert.equal(result.list.length, 4);
  assert.equal(0 in result.list, false);
  assert.equal(1 in result.list, true);
  assert.equal(result.list.extra, 'metadata');
});

test('preserves ArrayBuffer and overlapping typed-array/DataView identity and offsets', () => {
  const buffer = new ArrayBuffer(24);
  new Uint8Array(buffer).set([0, 1, 2, 3, 4, 5, 6, 7]);
  const input = { buffer, bytes: new Uint8Array(buffer, 2, 6), words: new Uint16Array(buffer, 4, 3), view: new DataView(buffer, 1, 9) };
  const result = roundTrip(input);
  assert.notEqual(result.buffer, buffer);
  assert.equal(result.bytes.buffer, result.buffer);
  assert.equal(result.words.buffer, result.buffer);
  assert.equal(result.view.buffer, result.buffer);
  assert.equal(result.bytes.byteOffset, 2);
  assert.equal(result.bytes.length, 6);
  assert.equal(result.words.byteOffset, 4);
  assert.equal(result.words.length, 3);
  assert.equal(result.view.byteOffset, 1);
  assert.equal(result.view.byteLength, 9);
  assert.deepEqual(Array.from(result.bytes), [2, 3, 4, 5, 6, 7]);
  result.bytes[2] = 99;
  assert.equal(result.view.getUint8(3), 99);
  assert.equal(new Uint8Array(buffer)[4], 4);
});

test('round trips a large typed array and overlapping views within the graph budget', () => {
  const length = 1_818_342;
  const buffer = new ArrayBuffer(length);
  const whole = new Uint8Array(buffer);
  whole[0] = 17;
  whole[length - 1] = 91;
  const bytes = new Uint8Array(buffer, 1, length - 2);
  const overlap = new Uint8Array(buffer, length - 4, 4);
  const view = new DataView(buffer, length - 8, 8);
  const result = roundTrip({ buffer, bytes, overlap, view, again: bytes }, { maxNodes: 64 });
  assert.equal(result.buffer.byteLength, length);
  assert.equal(result.bytes.buffer, result.buffer);
  assert.equal(result.overlap.buffer, result.buffer);
  assert.equal(result.view.buffer, result.buffer);
  assert.equal(result.again, result.bytes);
  assert.equal(result.bytes.byteOffset, 1);
  assert.equal(result.bytes.length, length - 2);
  assert.equal(new Uint8Array(result.buffer)[0], 17);
  assert.equal(result.view.getUint8(7), 91);
  result.overlap[0] = 42;
  assert.equal(result.view.getUint8(4), 42);
});

test('supports a typed array near the unchanged 8 MiB encoded byte limit', () => {
  const length = 6 * 1024 * 1024 - 1024;
  const bytes = new Uint8Array(length);
  bytes[0] = 11;
  bytes[length - 1] = 99;
  const encoded = encodeWireValue(bytes);
  const encodedBytes = Buffer.byteLength(encoded);
  assert.ok(encodedBytes > WIRE_DEFAULT_LIMITS.maxEncodedBytes - 4096);
  assert.ok(encodedBytes <= WIRE_DEFAULT_LIMITS.maxEncodedBytes);
  const result = decodeWireValue(encoded);
  assert.equal(result.length, length);
  assert.equal(result[0], 11);
  assert.equal(result[length - 1], 99);
  assert.throws(() => encodeWireValue(bytes, { maxDecodedBytes: length - 1 }));
  assert.throws(() => decodeWireValue(encoded, { maxDecodedBytes: length - 1 }));
  assert.throws(() => encodeWireValue(bytes, { maxEncodedBytes: encodedBytes - 1 }));
  assert.throws(() => decodeWireValue(encoded, { maxEncodedBytes: encodedBytes - 1 }));
  assert.throws(() => encodeWireValue(new Uint8Array(6 * 1024 * 1024 + 3)));
});

test('preserves all standard typed-array kinds available in the current engine', () => {
  const names = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
  for (const name of names) {
    const Ctor = globalThis[name];
    if (typeof Ctor !== 'function') continue;
    const source = name.startsWith('Big') ? new Ctor([1n, 2n]) : new Ctor([1, 2]);
    const result = roundTrip(source);
    assert.equal(Object.getPrototypeOf(result), Ctor.prototype, name);
    assert.deepEqual(Array.from(result), Array.from(source), name);
  }
});

test('base64 conversion preserves bytes across chunk and padding boundaries', () => {
  for (const length of [0, 1, 2, 3, 24_575, 24_576, 24_577, 49_151, 49_152, 49_153]) {
    const input = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) input[index] = (index * 37 + 19) & 255;
    const encoded = encodeWireValue(input);
    const binaryNode = JSON.parse(encoded).nodes.find((node) => node[0] === 'arraybuffer');
    assert.equal(binaryNode[1], Buffer.from(input).toString('base64'), `encoding length ${length}`);
    assert.deepEqual(decodeWireValue(encoded), input, `decoding length ${length}`);
  }
});

test('base64 conversion retains its pure JavaScript fallback', () => {
  const originalBtoa = Object.getOwnPropertyDescriptor(globalThis, 'btoa');
  const originalAtob = Object.getOwnPropertyDescriptor(globalThis, 'atob');
  try {
    Object.defineProperty(globalThis, 'btoa', { value: undefined, configurable: true });
    Object.defineProperty(globalThis, 'atob', { value: undefined, configurable: true });
    const input = Uint8Array.from({ length: 24_577 }, (_, index) => (index * 19 + 3) & 255);
    const encoded = encodeWireValue(input);
    assert.equal(JSON.parse(encoded).nodes.find((node) => node[0] === 'arraybuffer')[1], Buffer.from(input).toString('base64'));
    assert.deepEqual(decodeWireValue(encoded), input);
  } finally {
    if (originalBtoa) Object.defineProperty(globalThis, 'btoa', originalBtoa);
    else delete globalThis.btoa;
    if (originalAtob) Object.defineProperty(globalThis, 'atob', originalAtob);
    else delete globalThis.atob;
  }
});

test('browser native base64 path preserves views, strict validation, and fallback', () => {
  // Isolate global feature detection and prototype replacements from all other
  // tests. The module is loaded with no Node process, as in the browser.
  const script = `
    import assert from 'node:assert/strict';
    const savedProcess = globalThis.process, source = savedProcess.argv[1];
    globalThis.process = undefined;
    const { encodeWireValue, decodeWireValue } = await import(source);
    globalThis.process = savedProcess;
    let encodes = 0, decodes = 0;
    Uint8Array.prototype.toBase64 = function () {
      encodes += 1;
      return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64');
    };
    Uint8Array.prototype.setFromBase64 = function (value, options) {
      assert.equal(options.lastChunkHandling, 'strict');
      decodes += 1;
      const sourceBytes = Buffer.from(value, 'base64');
      this.set(sourceBytes);
      return { read: value.length, written: sourceBytes.length };
    };
    const bytes = Uint8Array.from({ length: 10013 }, (_, i) => (i * 19 + 7) & 255);
    const input = { buffer: bytes.buffer, view: new Uint8Array(bytes.buffer, 7, 100), dataView: new DataView(bytes.buffer, 9, 40) };
    const encoded = encodeWireValue(input), output = decodeWireValue(encoded);
    assert.equal(encodes, 1);
    assert.equal(decodes, 1);
    assert.equal(output.view.byteOffset, 7);
    assert.equal(output.dataView.byteOffset, 9);
    assert.equal(output.buffer, output.view.buffer);
    assert.equal(output.buffer, output.dataView.buffer);
    assert.deepEqual([...new Uint8Array(output.buffer)], [...bytes]);
    assert.throws(() => encodeWireValue(input, { maxEncodedBytes: 100 }));
    assert.equal(encodes, 1);
    const malformed = JSON.stringify({ format: 'chatgpt-apphost-wire', version: 1, root: ['r', 0], nodes: [['arraybuffer', 'Zh==']] });
    assert.throws(() => decodeWireValue(malformed), { code: 'invalid' });
    assert.equal(decodes, 1);
    delete Uint8Array.prototype.toBase64;
    delete Uint8Array.prototype.setFromBase64;
    assert.deepEqual([...decodeWireValue(encodeWireValue(bytes))], [...bytes]);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, new URL('../src/wire-value.mjs', import.meta.url).href], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('preserves supported Date, Map, Set, and RegExp values and cyclic members', () => {
  const date = new Date('2026-11-03T00:00:00.000Z');
  const invalidDate = new Date(NaN);
  const expression = /a+b/giu;
  expression.lastIndex = 3;
  const input = { date, invalidDate, expression, map: new Map(), set: new Set() };
  input.map.set(input, input.set);
  input.set.add(input.map);
  const result = roundTrip(input);
  assert.equal(result.date.toISOString(), date.toISOString());
  assert.ok(Number.isNaN(result.invalidDate.getTime()));
  assert.equal(result.expression.source, expression.source);
  assert.equal(result.expression.flags, expression.flags);
  assert.equal(result.expression.lastIndex, 3);
  assert.equal(result.map.get(result), result.set);
  assert.equal(result.set.has(result.map), true);
});

test('does not invoke payload getters, setters, or toJSON while rejecting them', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'secret', { enumerable: true, get() { calls += 1; return 1; } });
  const hiddenGetter = Object.defineProperty({}, 'secret', { get() { calls += 1; return 1; } });
  const toJSON = { toJSON() { calls += 1; return { changed: true }; } };
  for (const input of [getter, hiddenGetter, toJSON]) assert.throws(() => encodeWireValue(input));
  assert.equal(calls, 0);
});

test('ignores symbol-keyed ordinary object and array properties like structured clone', () => {
  let getterCalls = 0;
  const getter = () => { getterCalls += 1; throw new Error('symbol getter must not run'); };
  const object = { keep: 1 };
  const array = [1, 2];
  const nullObject = Object.assign(Object.create(null), { keep: 2 });
  for (const input of [object, array, nullObject]) {
    Object.defineProperty(input, Symbol.toStringTag, { enumerable: true, get: getter });
    Object.defineProperty(input, Symbol('hidden'), { enumerable: false, get: getter });
  }
  for (const input of [object, array]) {
    const expected = structuredClone(input);
    const result = roundTrip(input);
    assert.deepEqual(result, expected);
    assert.equal(Object.getOwnPropertySymbols(result).length, 0);
  }
  const nullResult = roundTrip(nullObject);
  assert.equal(Object.getPrototypeOf(nullResult), null);
  assert.equal(nullResult.keep, 2);
  assert.equal(Object.getOwnPropertySymbols(nullResult).length, 0);
  assert.equal(getterCalls, 0);
});

test('does not ask for descriptors of ignored symbol keys', () => {
  let symbolDescriptors = 0;
  const input = new Proxy({ keep: 1, [Symbol('ignored')]: 2 }, {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'symbol') {
        symbolDescriptors += 1;
        throw new Error('symbol descriptor must not be read');
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(roundTrip(input), { keep: 1 });
  assert.equal(symbolDescriptors, 0);
});

test('rejects functions, symbols, host objects, custom prototypes, and unsupported errors', () => {
  class Custom { constructor() { this.value = 1; } }
  const channel = new MessageChannel();
  try {
    for (const input of [() => 1, Symbol('x'), { value: Symbol('x') }, [Symbol('x')], new Map([[Symbol('x'), 1]]), new Set([Symbol('x')]), new Custom(), Promise.resolve(1), new Error('x'), channel.port1]) {
      assert.throws(() => encodeWireValue(input));
    }
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});

test('rejects custom properties on other built-ins instead of silently discarding them', () => {
  const date = new Date();
  date.extra = 3;
  const buffer = new ArrayBuffer(2);
  buffer.extra = 3;
  const view = new DataView(new ArrayBuffer(2));
  view.extra = 3;
  for (const input of [date, buffer, view]) assert.throws(() => encodeWireValue(input));
});

test('uses structured-clone semantics for typed-array custom properties without invoking getters', () => {
  let calls = 0;
  const bytes = new Uint8Array([1, 2]);
  const getter = () => { calls += 1; throw new Error('unexpected getter'); };
  const ignoredKeys = ['extra', '__proto__', 'constructor', 'prototype', 'buffer', 'byteOffset', 'byteLength', 'length'];
  for (const key of ignoredKeys) Object.defineProperty(bytes, key, { enumerable: true, get: getter });
  Object.defineProperty(bytes, Symbol('extra'), { get: getter });
  const expected = structuredClone(bytes);
  const result = roundTrip(bytes);
  assert.deepEqual([...result], [...expected]);
  assert.equal(Object.getPrototypeOf(result), Uint8Array.prototype);
  for (const key of ignoredKeys) {
    assert.equal(Object.hasOwn(expected, key), false);
    assert.equal(Object.hasOwn(result, key), false);
  }
  assert.equal(Object.getOwnPropertySymbols(result).length, 0);
  assert.equal(calls, 0);
});

test('rejects detached, resizable, and shared binary backing stores', () => {
  const detached = new ArrayBuffer(4);
  structuredClone(detached, { transfer: [detached] });
  assert.throws(() => encodeWireValue(detached));
  const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
  if (resizable.resizable) assert.throws(() => encodeWireValue(resizable));
  if (typeof SharedArrayBuffer === 'function') {
    const shared = new SharedArrayBuffer(4);
    assert.throws(() => encodeWireValue(shared));
    assert.throws(() => encodeWireValue(new Uint8Array(shared)));
  }
});

test('rejects dangerous property keys on both encoding and decoding', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const input = Object.create(null);
    input[key] = { polluted: true };
    assert.throws(() => encodeWireValue(input));
    assert.throws(() => decodeWireValue(envelope(['r', 0], [['object', true, [[key, true]]]])));
  }
  assert.equal({}.polluted, undefined);
});

test('enforces exact encoded UTF-8 byte limits in both directions', () => {
  const value = { text: '汉😀' };
  const encoded = encodeWireValue(value);
  const bytes = Buffer.byteLength(encoded, 'utf8');
  assert.deepEqual(roundTrip(value, { maxEncodedBytes: bytes }), value);
  assert.throws(() => encodeWireValue(value, { maxEncodedBytes: bytes - 1 }));
  assert.throws(() => decodeWireValue(encoded, { maxEncodedBytes: bytes - 1 }));
});

test('counts long mixed UTF-16 strings and surrogate boundaries exactly', () => {
  const values = [
    'a'.repeat(4095) + '😀' + '中'.repeat(18000),
    'a'.repeat(4095) + '\ud800' + 'b'.repeat(40000),
    '中'.repeat(16383) + '\udc00' + '😀'.repeat(5000),
    '中' + 'a'.repeat(65536),
  ];
  for (const value of values) {
    const decodedBytes = Buffer.byteLength(value, 'utf8');
    const encoded = encodeWireValue(value, { maxDecodedBytes: decodedBytes });
    const encodedBytes = Buffer.byteLength(encoded, 'utf8');
    assert.equal(decodeWireValue(encoded, { maxDecodedBytes: decodedBytes, maxEncodedBytes: encodedBytes }), value);
    assert.throws(() => encodeWireValue(value, { maxDecodedBytes: decodedBytes - 1 }));
    assert.throws(() => decodeWireValue(encoded, { maxDecodedBytes: decodedBytes - 1 }));
    assert.throws(() => encodeWireValue(value, { maxEncodedBytes: encodedBytes - 1 }));
    assert.throws(() => decodeWireValue(encoded, { maxEncodedBytes: encodedBytes - 1 }));
  }
});

test('retains UTF-8 counting when TextEncoder or encodeInto is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');
  const value = 'a'.repeat(4095) + '😀' + '\ud800' + '中'.repeat(18000);
  const length = Buffer.byteLength(value, 'utf8');
  try {
    for (const replacement of [undefined, class WithoutEncodeInto {}]) {
      Object.defineProperty(globalThis, 'TextEncoder', { value: replacement, configurable: true });
      const encoded = encodeWireValue(value, { maxDecodedBytes: length });
      assert.equal(decodeWireValue(encoded, { maxDecodedBytes: length }), value);
      assert.throws(() => encodeWireValue(value, { maxDecodedBytes: length - 1 }));
      assert.throws(() => decodeWireValue(encoded, { maxDecodedBytes: length - 1 }));
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'TextEncoder', original);
    else delete globalThis.TextEncoder;
  }
});

test('enforces decoded string and binary byte limits in both directions', () => {
  const value = '😀😀';
  const encoded = encodeWireValue(value);
  assert.equal(roundTrip(value, { maxDecodedBytes: 8 }), value);
  assert.throws(() => encodeWireValue(value, { maxDecodedBytes: 7 }));
  assert.throws(() => decodeWireValue(encoded, { maxDecodedBytes: 7 }));
  const buffer = new Uint8Array(32).buffer;
  const encodedBuffer = encodeWireValue(buffer);
  assert.throws(() => encodeWireValue(buffer, { maxDecodedBytes: 31 }));
  assert.throws(() => decodeWireValue(encodedBuffer, { maxDecodedBytes: 31 }));
});

test('enforces node and depth budgets without losing cycle support', () => {
  const values = [0, 1, 2, 3, 4];
  const encodedValues = encodeWireValue(values);
  assert.throws(() => encodeWireValue(values, { maxNodes: 4 }));
  assert.throws(() => decodeWireValue(encodedValues, { maxNodes: 4 }));
  const value = { a: { b: { c: 1 } } };
  const encodedValue = encodeWireValue(value);
  assert.throws(() => encodeWireValue(value, { maxDepth: 2 }));
  assert.throws(() => decodeWireValue(encodedValue, { maxDepth: 2 }));
  const cycle = {};
  cycle.self = cycle;
  assert.equal(roundTrip(cycle, { maxDepth: 2 }).self.self.self.self.self !== undefined, true);
});

test('still budgets distinct typed-array views and their backing-buffer depth', () => {
  const single = new Uint8Array(1000);
  const encodedSingle = encodeWireValue(single, { maxNodes: 2 });
  assert.equal(decodeWireValue(encodedSingle, { maxNodes: 2 }).length, 1000);
  assert.throws(() => encodeWireValue(single, { maxNodes: 1 }));
  assert.throws(() => decodeWireValue(encodedSingle, { maxNodes: 1 }));
  const buffer = new ArrayBuffer(16);
  const views = Array.from({ length: 12 }, (_, index) => new Uint8Array(buffer, index, 1));
  const encoded = encodeWireValue(views);
  assert.throws(() => encodeWireValue(views, { maxNodes: 12 }));
  assert.throws(() => decodeWireValue(encoded, { maxNodes: 12 }));
  const value = { bytes: views[0] };
  const encodedValue = encodeWireValue(value);
  assert.throws(() => encodeWireValue(value, { maxDepth: 1 }));
  assert.throws(() => decodeWireValue(encodedValue, { maxDepth: 1 }));
});

test('shared references cannot hide a deep acyclic path from the depth budget', () => {
  const tail = { value: 1 };
  const middle = { next: tail };
  const head = { next: middle };
  // The shallow entries are visited first, before the longer shared path.
  const value = { tail, middle, head };
  const encoded = encodeWireValue(value);
  assert.throws(() => encodeWireValue(value, { maxDepth: 2 }));
  assert.throws(() => decodeWireValue(encoded, { maxDepth: 2 }));
});

test('rejects malformed envelopes, versions, unknown tags, and invalid references', () => {
  for (const input of [
    '', 'null', '{}', '{"format":"chatgpt-apphost-wire","version":2,"root":null,"nodes":[]}',
    envelope(['not-a-token'], []),
    envelope(['r', 0], []),
    envelope(['r', -1], [['array', 0, []]]),
    envelope(['r', 0], [['not-a-node']]),
    envelope(null, [['array', 0, []]]),
    envelope(['r', 0], [['object', false, [['x', 1], ['x', 2]]]]),
    envelope(['r', 0], [['array', 1, [['2', true]]]]),
  ]) assert.throws(() => decodeWireValue(input), input.slice(0, 100));
});

test('rejects noncanonical, malformed, and over-budget base64 before allocation', () => {
  for (const base64 of ['x===', 'Zm9v=', 'Zg', 'Zh==', 'Zm+_', 'Zg==\n']) {
    assert.throws(() => decodeWireValue(envelope(['r', 0], [['arraybuffer', base64]])), base64);
  }
  assert.throws(() => decodeWireValue(envelope(['r', 0], [['arraybuffer', 'AAECAwQF']]), { maxDecodedBytes: 5 }));
  assert.throws(() => decodeWireValue(envelope(['r', 0], [['array', 4294967295, []]]), { maxDecodedBytes: 1024 }));
});

test('rejects illegal characters throughout a large base64 buffer', () => {
  const good = Buffer.alloc(256 * 1024, 191).toString('base64');
  for (const index of [0, Math.floor(good.length / 2), good.length - 5]) {
    const bad = good.slice(0, index) + '!' + good.slice(index + 1);
    assert.throws(() => decodeWireValue(envelope(['r', 0], [['arraybuffer', bad]])), { code: 'invalid' });
  }
  const noncanonical = good.slice(0, -2) + 'B=';
  assert.throws(() => decodeWireValue(envelope(['r', 0], [['arraybuffer', noncanonical]])), { code: 'invalid' });
});

test('rejects malformed view ranges, type names, BigInts, and budgets', () => {
  for (const input of [
    envelope(['r', 1], [['arraybuffer', 'AAAAAA=='], ['view', 'Uint32Array', 0, 1, 1]]),
    envelope(['r', 1], [['arraybuffer', 'AAAAAA=='], ['view', 'Uint8Array', 0, 3, 2]]),
    envelope(['r', 1], [['arraybuffer', 'AAAAAA=='], ['view', 'NotAnArray', 0, 0, 1]]),
    envelope(['r', 0], [['view', 'Uint8Array', 0, 0, 0]]),
    envelope(['i', '01'], []), envelope(['i', '-0'], []),
  ]) assert.throws(() => decodeWireValue(input));
  for (const limits of [{ maxNodes: 0 }, { maxDepth: -1 }, { maxEncodedBytes: -1 }, { maxDecodedBytes: 1.5 }]) {
    assert.throws(() => encodeWireValue(null, limits));
    assert.throws(() => decodeWireValue(encodeWireValue(null), limits));
  }
  assert.equal(WIRE_DEFAULT_LIMITS.maxEncodedBytes, 8 * 1024 * 1024);
  assert.equal(WIRE_DEFAULT_LIMITS.maxDecodedBytes, 8 * 1024 * 1024);
});

test('rejects duplicate logical Map and Set entries in untrusted wire input', () => {
  const duplicateMap = envelope(['r', 0], [['map', [[['n', 'NaN'], 1], [['n', 'NaN'], 2]]]]);
  const duplicateSet = envelope(['r', 0], [['set', [0, ['n', '-0']]]]);
  assert.throws(() => decodeWireValue(duplicateMap));
  assert.throws(() => decodeWireValue(duplicateSet));
});
