import test from 'node:test';
import assert from 'node:assert/strict';
import * as codec from '../src/wire-value.mjs';

test('returns the exact encoded bytes and node count with the validated immutable snapshot', () => {
  assert.equal(typeof codec.encodeWireValueDetailed, 'function');
  const shared = { text: ('A中文😀\ud800\u0000\\"').repeat(130_000) };
  const graph = { first: shared, second: shared, binary: new Uint8Array([0, 1, 255]) };
  graph.cycle = graph;
  const result = codec.encodeWireValueDetailed(graph);
  assert.equal(result.encoded, codec.encodeWireValue(graph));
  assert.equal(result.encodedBytes, Buffer.byteLength(result.encoded, 'utf8'));
  assert.equal(result.nodeCount, JSON.parse(result.encoded).nodes.length);
  assert.equal(Object.isFrozen(result), true);
  const decoded = codec.decodeWireValue(result.encoded);
  assert.equal(decoded.cycle, decoded);
  assert.equal(decoded.first, decoded.second);
  assert.equal(decoded.first.text, shared.text);
  assert.deepEqual(decoded.binary, graph.binary);
});

test('detailed encoding uses the same rejection and exact boundary as ordinary encoding', () => {
  const value = { text: ('é😀\\"\u0000').repeat(4000) };
  const encoded = codec.encodeWireValue(value);
  const size = Buffer.byteLength(encoded);
  const limits = { maxEncodedBytes: size };
  const result = codec.encodeWireValueDetailed(value, limits);
  assert.equal(result.encoded, encoded);
  assert.equal(result.encodedBytes, size);
  for (const encode of [codec.encodeWireValue, codec.encodeWireValueDetailed]) {
    assert.throws(() => encode(value, { maxEncodedBytes: size - 1 }), { code: 'limit' });
    assert.throws(() => encode({ uncloneable: () => {} }), { code: 'unsupported' });
    assert.throws(() => encode(value, { maxNodes: 1 }), { code: 'limit' });
  }
});
