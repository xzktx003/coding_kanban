/**
 * Bounded, versioned value transport for the AppHost bridge.
 *
 * The wire representation is JSON text, but input objects are never passed to
 * JSON.stringify: their data descriptors are copied to a closed value grammar.
 * Function and symbol values, custom prototypes, accessors and unsupported host
 * values fail closed. Ordinary object/array symbol-keyed properties are ignored
 * without reading their descriptors, as in structured clone. String properties
 * named __proto__, constructor or prototype are deliberately forbidden.
 * Non-enumerable custom properties and
 * custom properties on built-ins are rejected, except for typed arrays: as in
 * structured clone, only the backing buffer, offset and length are represented,
 * and any extra typed-array properties are ignored without reading them.
 *
 * Limits apply independently in both directions. Encoded bytes mean UTF-8 wire
 * bytes. Decoded bytes are a conservative content budget: UTF-8 string/key and
 * bigint text bytes, distinct ArrayBuffer bytes, eight bytes per array slot,
 * and eight bytes per Date. Nodes count value occurrences and array slots,
 * including references. Typed-array elements are binary content rather than
 * graph nodes; each distinct backing buffer still counts against the byte budget.
 *
 * Date, Map, Set and RegExp are supported; Error, SharedArrayBuffer, resizable
 * ArrayBuffer, subclasses, cross-realm prototypes and host objects are not.
 * BigInt decimal encodings are limited to 16,384 characters. Graph-depth
 * validation also counts repeated paths against the traversal/node budget.
 * As with any browser-portable reflective serializer, JavaScript has no general
 * way to detect a Proxy without invoking its traps; callers must not supply
 * untrusted executable Proxy objects. No input getter or toJSON is invoked.
 */

const FORMAT = 'chatgpt-apphost-wire';
const VERSION = 1;
const MAX_DEPTH = 256;
const MAX_BIGINT_DIGITS = 16384;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// This module also runs directly in the browser, where Node builtins do not
// exist. In a real Node process use its native codec, without bundler shims.
const nodeBuffer = (() => {
  try {
    const proc = globalThis.process;
    if (proc?.release?.name !== 'node' || typeof proc.getBuiltinModule !== 'function') return undefined;
    const buffer = proc.getBuiltinModule('node:buffer')?.Buffer;
    return typeof buffer?.from === 'function' ? buffer : undefined;
  } catch { return undefined; }
})();

export const WIRE_DEFAULT_LIMITS = Object.freeze({
  maxEncodedBytes: 8 * 1024 * 1024,
  maxDecodedBytes: 8 * 1024 * 1024,
  maxNodes: 1_000_000,
  maxDepth: 128,
});

export class WireValueError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WireValueError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new WireValueError(code, message);
}

function limitsFor(value) {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    fail('invalid_limit', 'limits must be an object');
  }
  const result = { ...WIRE_DEFAULT_LIMITS };
  if (value !== undefined) {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !Object.hasOwn(result, key)) fail('invalid_limit', 'unknown limit');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid_limit', 'limit accessor is unsupported');
      result[key] = descriptor.value;
    }
  }
  for (const key of ['maxEncodedBytes', 'maxDecodedBytes', 'maxNodes']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 1) fail('invalid_limit', `invalid ${key}`);
  }
  if (!Number.isSafeInteger(result.maxDepth) || result.maxDepth < 0 || result.maxDepth > MAX_DEPTH) {
    fail('invalid_limit', `maxDepth must be between 0 and ${MAX_DEPTH}`);
  }
  return result;
}

function utf8Length(value) {
  // Count long strings with bounded scratch space. Chunk boundaries must not
  // split a surrogate pair or the replacement-byte count would be incorrect.
  if (value.length >= 16384 && typeof globalThis.TextEncoder === 'function') {
    const encoder = new globalThis.TextEncoder();
    if (typeof encoder.encodeInto === 'function') {
      const scratch = new Uint8Array(3 * 4096);
      let count = 0;
      for (let start = 0; start < value.length;) {
        let end = Math.min(start + 4096, value.length);
        if (end < value.length) {
          const previous = value.charCodeAt(end - 1), next = value.charCodeAt(end);
          if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
        }
        const result = encoder.encodeInto(value.slice(start, end), scratch);
        if (result.read !== end - start) fail('invalid', 'UTF-8 counting failed');
        count += result.written;
        start = end;
      }
      return count;
    }
  }
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 0x80) count += 1;
    else if (c < 0x800) count += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      count += 4;
      i += 1;
    } else count += 3;
  }
  return count;
}

class Budget {
  constructor(limits) {
    this.limits = limits;
    this.nodes = 0;
    this.bytes = 0;
  }

  depth(value) {
    if (value > this.limits.maxDepth) fail('limit', 'wire depth budget exceeded');
  }

  addNodes(count = 1) {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.limits.maxNodes - this.nodes) {
      fail('limit', 'wire node budget exceeded');
    }
    this.nodes += count;
  }

  addBytes(count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.limits.maxDecodedBytes - this.bytes) {
      fail('limit', 'wire decoded byte budget exceeded');
    }
    this.bytes += count;
  }

  addString(value) {
    this.addBytes(utf8Length(value));
  }
}

function encodedLength(value, limits) {
  if (value.length > limits.maxEncodedBytes) {
    fail('limit', 'wire encoded byte budget exceeded');
  }
  const bytes = utf8Length(value);
  if (bytes > limits.maxEncodedBytes) fail('limit', 'wire encoded byte budget exceeded');
  return bytes;
}

function dataDescriptor(object, key) {
  const desc = Object.getOwnPropertyDescriptor(object, key);
  if (!desc || !Object.hasOwn(desc, 'value')) fail('unsupported', 'accessor property is unsupported');
  return desc;
}

function validPropertyKey(key) {
  if (typeof key !== 'string') fail('unsupported', 'symbol keys are unsupported');
  if (DANGEROUS_KEYS.has(key)) fail('invalid', 'unsafe property key');
}

function isArrayIndex(key) {
  if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const n = Number(key);
  return Number.isSafeInteger(n) && n >= 0 && n < 0xffffffff && String(n) === key;
}

function rejectExtraProperties(value, allowed = new Set()) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) fail('unsupported', 'custom property on built-in value');
    dataDescriptor(value, key);
  }
}

function ownProperties(value, budget, visit, depth, arrayLength = null) {
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    // Structured clone ignores symbol-keyed properties, even accessor ones.
    if (typeof key === 'symbol') continue;
    if (arrayLength !== null && key === 'length') continue;
    validPropertyKey(key);
    const desc = dataDescriptor(value, key);
    if (!desc.enumerable) fail('unsupported', 'non-enumerable custom property is unsupported');
    budget.addString(key);
    entries.push([key, visit(desc.value, depth + 1)]);
  }
  return entries;
}

function toBase64(bytes, limits) {
  const required = Math.ceil(bytes.length / 3) * 4;
  if (required > limits.maxEncodedBytes) fail('limit', 'wire encoded byte budget exceeded');
  const chunks = [];
  if (typeof globalThis.btoa === 'function') {
    if (nodeBuffer) return nodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    if (typeof Uint8Array.prototype.toBase64 === 'function') return Uint8Array.prototype.toBase64.call(bytes);
    // Each non-final block is a multiple of three so concatenating the encoded
    // blocks does not introduce padding in the middle of the stream.
    const blockSize = 24_576;
    for (let offset = 0; offset < bytes.length; offset += blockSize) {
      const block = bytes.subarray(offset, Math.min(offset + blockSize, bytes.length));
      chunks.push(globalThis.btoa(String.fromCharCode(...block)));
    }
    return chunks.join('');
  }
  let current = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    current += BASE64[a >>> 2] + BASE64[((a & 3) << 4) | (b >>> 4)] +
      (i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >>> 6)] : '=') +
      (i + 2 < bytes.length ? BASE64[c & 63] : '=');
    if (current.length >= 16384) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.join('');
}

function base64Length(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) fail('invalid', 'invalid base64 length');
  let padding = 0;
  if (value.endsWith('==')) padding = 2;
  else if (value.endsWith('=')) padding = 1;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))) fail('invalid', 'invalid base64 character');
  for (let i = value.length - padding; i < value.length; i += 1) {
    if (value[i] !== '=') fail('invalid', 'invalid base64 padding');
  }
  if (padding === 2 && (BASE64.indexOf(value[value.length - 3]) & 15) !== 0) fail('invalid', 'noncanonical base64');
  if (padding === 1 && (BASE64.indexOf(value[value.length - 2]) & 3) !== 0) fail('invalid', 'noncanonical base64');
  return (value.length / 4) * 3 - padding;
}

function fromBase64(value, length) {
  const bytes = new Uint8Array(length);
  let out = 0;
  if (typeof globalThis.atob === 'function') {
    if (nodeBuffer) {
      const target = nodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (target.write(value, 0, length, 'base64') !== length) fail('invalid', 'invalid base64 length');
      return bytes.buffer;
    }
    if (typeof Uint8Array.prototype.setFromBase64 === 'function') {
      const result = Uint8Array.prototype.setFromBase64.call(bytes, value, { lastChunkHandling: 'strict' });
      if (result.read !== value.length || result.written !== length) fail('invalid', 'invalid base64 length');
      return bytes.buffer;
    }
    const blockSize = 32_768;
    for (let offset = 0; offset < value.length; offset += blockSize) {
      const block = globalThis.atob(value.slice(offset, offset + blockSize));
      for (let index = 0; index < block.length; index += 1) bytes[out++] = block.charCodeAt(index);
    }
    return bytes.buffer;
  }
  for (let i = 0; i < value.length; i += 4) {
    const a = BASE64.indexOf(value[i]);
    const b = BASE64.indexOf(value[i + 1]);
    const c = value[i + 2] === '=' ? 0 : BASE64.indexOf(value[i + 2]);
    const d = value[i + 3] === '=' ? 0 : BASE64.indexOf(value[i + 3]);
    if (out < length) bytes[out++] = (a << 2) | (b >>> 4);
    if (out < length) bytes[out++] = ((b & 15) << 4) | (c >>> 2);
    if (out < length) bytes[out++] = ((c & 3) << 6) | d;
  }
  return bytes.buffer;
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const typedOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;
const typedLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length').get;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const resizableBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const viewBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer').get;
const viewOffset = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteOffset').get;
const viewLength = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength').get;
const regexpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get;
const regexpFlags = ['hasIndices', 'global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'unicodeSets', 'sticky']
  .map((name, index) => [Object.getOwnPropertyDescriptor(RegExp.prototype, name)?.get, 'dgimsuvy'[index]])
  .filter(([getter]) => getter);

const typedNames = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
const typedConstructors = new Map(typedNames.filter((name) => typeof globalThis[name] === 'function').map((name) => [name, globalThis[name]]));
const typedPrototypes = new Map(Array.from(typedConstructors, ([name, ctor]) => [ctor.prototype, name]));

function bigintText(value, budget) {
  const text = value.toString();
  if (text.length > MAX_BIGINT_DIGITS) fail('limit', 'bigint digit budget exceeded');
  budget.addString(text);
  return text;
}

// Revisit shared nodes along each distinct path; treating every previously seen
// reference as a leaf would let shallow aliases hide a deeper acyclic path.
// An active reference ends a cycle. Work is bounded independently so a densely
// connected graph cannot make this check exponential without hitting a limit.
function enforceGraphDepth(root, nodes, limits) {
  const active = new Set();
  let work = 0;
  function walk(token, depth) {
    if (depth > limits.maxDepth) fail('limit', 'wire depth budget exceeded');
    work += 1;
    if (work > limits.maxNodes) fail('limit', 'wire graph traversal budget exceeded');
    if (!Array.isArray(token) || token[0] !== 'r') return;
    const index = token[1];
    if (active.has(index)) return;
    active.add(index);
    const node = nodes[index];
    if (node[0] === 'object' || node[0] === 'array') {
      for (const entry of node[2]) walk(entry[1], depth + 1);
    } else if (node[0] === 'view') {
      walk(['r', node[2]], depth + 1);
    } else if (node[0] === 'map') {
      for (const [key, value] of node[1]) {
        walk(key, depth + 1);
        walk(value, depth + 1);
      }
    } else if (node[0] === 'set') {
      for (const item of node[1]) walk(item, depth + 1);
    } else if (node[0] === 'regexp') {
      walk(node[3], depth + 1);
    }
    active.delete(index);
  }
  walk(root, 0);
}

function encodeWireValueInternal(value, options, detailed) {
  const limits = limitsFor(options);
  const budget = new Budget(limits);
  const seen = new Map();
  const nodes = [];

  function visit(input, depth) {
    budget.depth(depth);
    budget.addNodes();
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') {
      budget.addString(input);
      return input;
    }
    if (typeof input === 'number') {
      if (Number.isNaN(input)) return ['n', 'NaN'];
      if (input === Infinity) return ['n', '+Infinity'];
      if (input === -Infinity) return ['n', '-Infinity'];
      if (Object.is(input, -0)) return ['n', '-0'];
      return input;
    }
    if (typeof input === 'undefined') return ['u'];
    if (typeof input === 'bigint') return ['i', bigintText(input, budget)];
    if (typeof input !== 'object') fail('unsupported', 'function or symbol value is unsupported');
    if (seen.has(input)) return ['r', seen.get(input)];

    const prototype = Object.getPrototypeOf(input);
    const index = nodes.length;
    if (index >= limits.maxNodes) fail('limit', 'wire node budget exceeded');
    seen.set(input, index);
    nodes.push(null);
    let node;

    if (Array.isArray(input)) {
      if (prototype !== Array.prototype) fail('unsupported', 'array subclass or cross-realm array is unsupported');
      const length = dataDescriptor(input, 'length').value;
      budget.addNodes(length);
      budget.addBytes(length * 8);
      node = ['array', length, ownProperties(input, budget, visit, depth, length)];
    } else if (prototype === null || prototype === Object.prototype) {
      node = ['object', prototype === null, ownProperties(input, budget, visit, depth)];
    } else if (prototype === ArrayBuffer.prototype) {
      rejectExtraProperties(input);
      if (resizableBuffer?.call(input)) fail('unsupported', 'resizable ArrayBuffer is unsupported');
      const length = bufferLength.call(input);
      budget.addBytes(length);
      let bytes;
      try { bytes = new Uint8Array(input); } catch { fail('unsupported', 'detached ArrayBuffer is unsupported'); }
      node = ['arraybuffer', toBase64(bytes, limits)];
    } else if (prototype === DataView.prototype) {
      rejectExtraProperties(input);
      const buffer = viewBuffer.call(input);
      const offset = viewOffset.call(input);
      const length = viewLength.call(input);
      const ref = visit(buffer, depth + 1);
      node = ['view', 'DataView', ref[1], offset, length];
    } else if (typedPrototypes.has(prototype)) {
      const length = typedLength.call(input);
      // Structured clone ignores typed-array own properties. Do not enumerate
      // integer indices: a valid binary payload may contain millions of them.
      const buffer = typedBuffer.call(input);
      const offset = typedOffset.call(input);
      const ref = visit(buffer, depth + 1);
      node = ['view', typedPrototypes.get(prototype), ref[1], offset, length];
    } else if (prototype === Date.prototype) {
      rejectExtraProperties(input);
      budget.addBytes(8);
      const time = Date.prototype.getTime.call(input);
      node = ['date', Number.isNaN(time) ? 'invalid' : time];
    } else if (prototype === Map.prototype) {
      rejectExtraProperties(input);
      const entries = [];
      for (const [key, item] of Map.prototype.entries.call(input)) entries.push([visit(key, depth + 1), visit(item, depth + 1)]);
      node = ['map', entries];
    } else if (prototype === Set.prototype) {
      rejectExtraProperties(input);
      const items = [];
      for (const item of Set.prototype.values.call(input)) items.push(visit(item, depth + 1));
      node = ['set', items];
    } else if (prototype === RegExp.prototype) {
      rejectExtraProperties(input, new Set(['lastIndex']));
      const source = regexpSource.call(input);
      const flags = regexpFlags.filter(([getter]) => getter.call(input)).map(([, flag]) => flag).join('');
      budget.addString(source);
      budget.addString(flags);
      node = ['regexp', source, flags, visit(dataDescriptor(input, 'lastIndex').value, depth + 1)];
    } else {
      fail('unsupported', 'unsupported object prototype');
    }
    nodes[index] = node;
    return ['r', index];
  }

  const root = visit(value, 0);
  enforceGraphDepth(root, nodes, limits);
  const encoded = JSON.stringify({ format: FORMAT, version: VERSION, root, nodes });
  const encodedBytes = encodedLength(encoded, limits);
  return detailed ? Object.freeze({ encoded, encodedBytes, nodeCount: nodes.length }) : encoded;
}

export function encodeWireValue(value, options) {
  return encodeWireValueInternal(value, options, false);
}

// The bridge needs the exact wire charge and graph size for its bounded
// snapshot. Return them from the same validation pass as the encoded value.
export function encodeWireValueDetailed(value, options) {
  return encodeWireValueInternal(value, options, true);
}

function exactArray(value, length) {
  return Array.isArray(value) && value.length === length;
}

function validInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function decodeWireValue(encoded, options) {
  const limits = limitsFor(options);
  if (typeof encoded !== 'string') fail('invalid', 'wire value must be JSON text');
  encodedLength(encoded, limits);
  let envelope;
  try { envelope = JSON.parse(encoded); } catch { fail('invalid', 'invalid wire JSON'); }
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'format,nodes,root,version' ||
      envelope.format !== FORMAT || envelope.version !== VERSION || !Array.isArray(envelope.nodes)) {
    fail('invalid', 'invalid wire envelope or version');
  }
  const nodes = envelope.nodes;
  if (nodes.length > limits.maxNodes) fail('limit', 'wire node budget exceeded');
  const budget = new Budget(limits);
  const expanded = new Set();
  const binaryLengths = new Map();

  function validateProperties(entries, depth, arrayLength = null) {
    if (!Array.isArray(entries)) fail('invalid', 'invalid property entries');
    const keys = new Set();
    for (const entry of entries) {
      if (!exactArray(entry, 2)) fail('invalid', 'invalid property entry');
      const key = entry[0];
      validPropertyKey(key);
      if (keys.has(key)) fail('invalid', 'duplicate property key');
      if (arrayLength !== null && (key === 'length' || (isArrayIndex(key) && Number(key) >= arrayLength))) {
        fail('invalid', 'array property exceeds declared length');
      }
      keys.add(key);
      budget.addString(key);
      validateToken(entry[1], depth + 1);
    }
  }

  function validateToken(token, depth) {
    budget.depth(depth);
    budget.addNodes();
    if (token === null || typeof token === 'boolean') return;
    if (typeof token === 'string') { budget.addString(token); return; }
    if (typeof token === 'number') {
      if (!Number.isFinite(token) || Object.is(token, -0)) fail('invalid', 'invalid numeric token');
      return;
    }
    if (!Array.isArray(token) || typeof token[0] !== 'string') fail('invalid', 'invalid value token');
    if (exactArray(token, 1) && token[0] === 'u') return;
    if (exactArray(token, 2) && token[0] === 'n' && ['NaN', '+Infinity', '-Infinity', '-0'].includes(token[1])) return;
    if (exactArray(token, 2) && token[0] === 'i') {
      const text = token[1];
      if (typeof text !== 'string' || text.length > MAX_BIGINT_DIGITS || !/^(0|-?[1-9][0-9]*)$/.test(text)) fail('invalid', 'invalid bigint');
      budget.addString(text);
      return;
    }
    if (!exactArray(token, 2) || token[0] !== 'r' || !validInteger(token[1]) || token[1] >= nodes.length) {
      fail('invalid', 'unknown token or invalid reference');
    }
    const index = token[1];
    if (expanded.has(index)) return;
    expanded.add(index);
    const node = nodes[index];
    if (!Array.isArray(node) || typeof node[0] !== 'string') fail('invalid', 'invalid node');
    switch (node[0]) {
      case 'object':
        if (!exactArray(node, 3) || typeof node[1] !== 'boolean') fail('invalid', 'invalid object node');
        validateProperties(node[2], depth);
        break;
      case 'array':
        if (!exactArray(node, 3) || !validInteger(node[1]) || node[1] > 0xffffffff) fail('invalid', 'invalid array node');
        budget.addNodes(node[1]);
        budget.addBytes(node[1] * 8);
        validateProperties(node[2], depth, node[1]);
        break;
      case 'arraybuffer': {
        if (!exactArray(node, 2)) fail('invalid', 'invalid buffer node');
        const length = base64Length(node[1]);
        budget.addBytes(length);
        binaryLengths.set(index, length);
        break;
      }
      case 'view': {
        if (!exactArray(node, 5) || typeof node[1] !== 'string' || (node[1] !== 'DataView' && !typedConstructors.has(node[1])) ||
            !validInteger(node[2]) || !validInteger(node[3]) || !validInteger(node[4]) || node[2] >= nodes.length) {
          fail('invalid', 'invalid view node');
        }
        if (!Array.isArray(nodes[node[2]]) || nodes[node[2]][0] !== 'arraybuffer') fail('invalid', 'view must reference an ArrayBuffer');
        validateToken(['r', node[2]], depth + 1);
        const size = binaryLengths.get(node[2]);
        const elementSize = node[1] === 'DataView' ? 1 : typedConstructors.get(node[1]).BYTES_PER_ELEMENT;
        if (node[3] % elementSize !== 0 || node[3] > size || node[4] > Math.floor((size - node[3]) / elementSize)) {
          fail('invalid', 'view exceeds buffer bounds');
        }
        break;
      }
      case 'date':
        if (!exactArray(node, 2) || (node[1] !== 'invalid' && (typeof node[1] !== 'number' || !Number.isFinite(node[1]) || new Date(node[1]).getTime() !== node[1]))) {
          fail('invalid', 'invalid Date node');
        }
        budget.addBytes(8);
        break;
      case 'map':
        if (!exactArray(node, 2) || !Array.isArray(node[1])) fail('invalid', 'invalid Map node');
        for (const entry of node[1]) {
          if (!exactArray(entry, 2)) fail('invalid', 'invalid Map entry');
          validateToken(entry[0], depth + 1);
          validateToken(entry[1], depth + 1);
        }
        break;
      case 'set':
        if (!exactArray(node, 2) || !Array.isArray(node[1])) fail('invalid', 'invalid Set node');
        for (const item of node[1]) validateToken(item, depth + 1);
        break;
      case 'regexp':
        if (!exactArray(node, 4) || typeof node[1] !== 'string' || typeof node[2] !== 'string') fail('invalid', 'invalid RegExp node');
        budget.addString(node[1]);
        budget.addString(node[2]);
        try { new RegExp(node[1], node[2]); } catch { fail('invalid', 'invalid RegExp pattern or flags'); }
        validateToken(node[3], depth + 1);
        break;
      default:
        fail('invalid', 'unknown node tag');
    }
  }

  validateToken(envelope.root, 0);
  if (expanded.size !== nodes.length) fail('invalid', 'unreachable wire node');
  enforceGraphDepth(envelope.root, nodes, limits);

  const objects = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    switch (node[0]) {
      case 'object': objects[i] = node[1] ? Object.create(null) : {}; break;
      case 'array': objects[i] = new Array(node[1]); break;
      case 'arraybuffer': objects[i] = fromBase64(node[1], binaryLengths.get(i)); break;
      case 'date': objects[i] = new Date(node[1] === 'invalid' ? NaN : node[1]); break;
      case 'map': objects[i] = new Map(); break;
      case 'set': objects[i] = new Set(); break;
      case 'regexp': objects[i] = new RegExp(node[1], node[2]); break;
      case 'view': break;
      default: fail('invalid', 'unknown node tag');
    }
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node[0] !== 'view') continue;
    try {
      objects[i] = node[1] === 'DataView' ? new DataView(objects[node[2]], node[3], node[4]) :
        new (typedConstructors.get(node[1]))(objects[node[2]], node[3], node[4]);
    } catch { fail('invalid', 'invalid view allocation'); }
  }

  function materialize(token) {
    if (!Array.isArray(token)) return token;
    switch (token[0]) {
      case 'u': return undefined;
      case 'n': return token[1] === 'NaN' ? NaN : token[1] === '+Infinity' ? Infinity : token[1] === '-Infinity' ? -Infinity : -0;
      case 'i': return BigInt(token[1]);
      case 'r': return objects[token[1]];
      default: fail('invalid', 'unknown token');
    }
  }

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const target = objects[i];
    if (node[0] === 'object' || node[0] === 'array') {
      for (const [key, item] of node[2]) {
        Object.defineProperty(target, key, { value: materialize(item), enumerable: true, writable: true, configurable: true });
      }
    } else if (node[0] === 'map') {
      for (const [key, item] of node[1]) {
        const k = materialize(key);
        if (target.has(k)) fail('invalid', 'duplicate Map key');
        target.set(k, materialize(item));
      }
    } else if (node[0] === 'set') {
      for (const item of node[1]) {
        const v = materialize(item);
        if (target.has(v)) fail('invalid', 'duplicate Set value');
        target.add(v);
      }
    } else if (node[0] === 'regexp') {
      Object.defineProperty(target, 'lastIndex', { value: materialize(node[3]) });
    }
  }
  return materialize(envelope.root);
}
