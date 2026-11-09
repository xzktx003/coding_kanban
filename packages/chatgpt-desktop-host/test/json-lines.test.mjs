import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import * as jsonLines from "../src/json-lines.mjs";
import {
  MAX_INPUT_CHUNK_BYTES,
  MAX_JSON_LINE_BYTES,
  parseJsonLines,
} from "../src/json-lines.mjs";

async function collect(chunks, options) {
  const lines = [];
  for await (const line of parseJsonLines(chunks, options)) lines.push(line);
  return lines;
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("preserves exact JSON text and handles UTF-8 split at every byte and CRLF", async () => {
  const first = '{"jsonrpc":"2.0","id":9007199254740993,"method":"x/通知","params":{"text":"😀"}}';
  const second = ' { "id":"0007", "result":"é" } ';
  const bytes = Buffer.from(`${first}\r\n${second}\n`);
  const chunks = Array.from(bytes, (byte) => Buffer.from([byte]));
  assert.deepEqual(await collect(chunks), [first, second]);
});

test("handles several lines per chunk and keeps line size separate from chunk size", async () => {
  const many = "{}\n[]\n0\ntrue\nnull\n\"x\"\n";
  assert.ok(Buffer.byteLength(many) > 4);
  assert.deepEqual(await collect([Buffer.from(many)], { maxLineBytes: 4 }), [
    "{}", "[]", "0", "true", "null", '"x"',
  ]);
});

test("pulls a queued multi-write Node stream in bounded pieces without prefetch", async () => {
  // Before the bounded reader exists, deliberately exercise the original
  // direct async-iterator path against the same real PassThrough backlog.
  const bounded = jsonLines.readBoundedChunks ?? ((stream) => stream);
  const prefix = '{"value":"';
  const first = prefix + 'x'.repeat(65535 - Buffer.byteLength(prefix)) + '😀"}';
  const others = Array.from({length:5},(_,i) => JSON.stringify({i,value:'y'.repeat(65510)}));
  const bytes = Buffer.from([first,...others].join('\n')+'\n');
  const stream = new PassThrough({highWaterMark:1024*1024});
  for (let offset=0;offset<bytes.length;offset+=65536) stream.write(bytes.subarray(offset,offset+65536));
  stream.end();
  assert.ok(stream.readableLength > 65536);
  const requested = [], read = stream.read;
  stream.read = function (size) { if (size > 0) requested.push(size); return read.call(this,size); };
  const iterator = parseJsonLines(bounded(stream,65536), {maxLineBytes:8*1024*1024,maxChunkBytes:65536});
  assert.equal((await iterator.next()).value,first);
  const held = stream.readableLength, pulls = requested.length;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stream.readableLength,held);
  assert.equal(requested.length,pulls);
  const actual=[];
  for await (const value of iterator) { actual.push(value); await Promise.resolve(); }
  assert.deepEqual(actual,others);
  assert.ok(requested.length > 2 && requested.every(size => size <= 65536));
});

test("bounded readable propagates close and errors and destroys on cancellation", async () => {
  assert.equal(typeof jsonLines.readBoundedChunks, "function");
  const cancelled = new PassThrough(), it = parseJsonLines(jsonLines.readBoundedChunks(cancelled,65536),{maxChunkBytes:65536});
  cancelled.write('{}\n');
  assert.equal((await it.next()).value,'{}');
  await it.return();
  assert.equal(cancelled.destroyed,true);

  const failed = new PassThrough(), failure = Error('source failure');
  const failing = parseJsonLines(jsonLines.readBoundedChunks(failed,65536),{maxChunkBytes:65536});
  const next = failing.next();
  failed.destroy(failure);
  await assert.rejects(next,error=>error===failure);

  const closed = new PassThrough(), closing = parseJsonLines(jsonLines.readBoundedChunks(closed,65536),{maxChunkBytes:65536});
  const waiting = closing.next();
  closed.destroy();
  await assert.rejects(waiting,{code:'ERR_STREAM_PREMATURE_CLOSE'});

  const ended = new PassThrough(), done = parseJsonLines(jsonLines.readBoundedChunks(ended,65536),{maxChunkBytes:65536});
  ended.end('{}\n');
  assert.deepEqual(await done.next(),{value:'{}',done:false});
  assert.deepEqual(await done.next(),{value:undefined,done:true});
});

test("accepts exact byte limit with LF and CRLF, including split CRLF", async () => {
  const lines = [Buffer.from('"éé"\r'), Buffer.from('\n"éé"\n')];
  assert.deepEqual(await collect(lines, { maxLineBytes: 6 }), ['"éé"', '"éé"']);
});

test("rejects oversized lines before reading later source chunks", async () => {
  let pulls = 0;
  let closed = false;
  async function* source() {
    try {
      pulls++;
      yield Buffer.from("123456");
      pulls++;
      yield Buffer.from("\n");
    } finally {
      closed = true;
    }
  }
  await rejectsCode(collect(source(), { maxLineBytes: 5 }), "JSONL_FRAME_TOO_LARGE");
  assert.equal(pulls, 1);
  assert.equal(closed, true);
});

test("CR only exempts one byte if immediately followed by LF", async () => {
  assert.deepEqual(await collect([Buffer.from("12345\r"), Buffer.from("\n")], { maxLineBytes: 5 }), ["12345"]);
  await rejectsCode(collect([Buffer.from("12345\r"), Buffer.from("x\n")], { maxLineBytes: 5 }), "JSONL_FRAME_TOO_LARGE");
});

test("fails closed on malformed JSON, empty lines and invalid UTF-8", async () => {
  for (const chunks of [
    [Buffer.from("{bad}\n")],
    [Buffer.from("\n")],
    [Buffer.from("   \n")],
    [Buffer.from([0xc3]), Buffer.from([0x28, 0x0a])],
    [Buffer.from([0xed, 0xa0, 0x80, 0x0a])],
  ]) {
    const code = chunks[0][0] === 0xc3 || chunks[0][0] === 0xed
      ? "JSONL_INVALID_UTF8" : "JSONL_INVALID_JSON";
    await rejectsCode(collect(chunks), code);
  }
});

test("does not silently erase a UTF-8 BOM before JSON validation", async () => {
  await rejectsCode(collect([Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a])]), "JSONL_INVALID_JSON");
});

test("reports any unfinished final line as truncated, even if it looks like JSON", async () => {
  for (const chunks of [[Buffer.from('{"id":')], [Buffer.from("{}")], [Buffer.from("{}\r")]]) {
    await rejectsCode(collect(chunks), "JSONL_TRUNCATED_EOF");
  }
  assert.deepEqual(await collect([]), []);
  assert.deepEqual(await collect([Buffer.from("{}\n")]), ["{}"]);
});

test("a bad later line fails without replaying or altering a previously emitted line", async () => {
  const iterator = parseJsonLines([Buffer.from('{"id":1}\n{bad}\n{"id":2}\n')]);
  assert.deepEqual(await iterator.next(), { value: '{"id":1}', done: false });
  await rejectsCode(iterator.next(), "JSONL_INVALID_JSON");
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
});

test("pulls only on demand and closes the source when the consumer stops", async () => {
  let pulls = 0;
  let closed = false;
  async function* source() {
    try {
      pulls++;
      yield Buffer.from("{}\n[]\n");
      pulls++;
      yield Buffer.from("null\n");
      pulls++;
      yield Buffer.from("false\n");
    } finally {
      closed = true;
    }
  }
  const iterator = parseJsonLines(source());
  assert.equal((await iterator.next()).value, "{}");
  assert.equal(pulls, 1);
  await Promise.resolve();
  assert.equal(pulls, 1);
  assert.equal((await iterator.next()).value, "[]");
  assert.equal(pulls, 1);
  assert.equal((await iterator.next()).value, "null");
  assert.equal(pulls, 2);
  await iterator.return();
  assert.equal(pulls, 2);
  assert.equal(closed, true);
});

test("destroys an owned Node Readable when parsing fails", async () => {
  const source = Readable.from([Buffer.from("not-json\n"), Buffer.from("{}\n")]);
  await rejectsCode(collect(source), "JSONL_INVALID_JSON");
  assert.equal(source.destroyed, true);
});

test("enforces a bounded chunk and only accepts byte chunks", async () => {
  await rejectsCode(collect([Buffer.from("{}\n[]\n")], { maxChunkBytes: 5 }), "JSONL_CHUNK_TOO_LARGE");
  await rejectsCode(collect(["{}\n"]), "JSONL_INVALID_CHUNK");
  assert.deepEqual(await collect([new Uint8Array([123, 125, 10])]), ["{}"]);
});

test("limits are positive integers and cannot exceed the hard caps", async () => {
  assert.equal(MAX_JSON_LINE_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_INPUT_CHUNK_BYTES, MAX_JSON_LINE_BYTES + 2);
  for (const options of [
    { maxLineBytes: 0 }, { maxLineBytes: -1 }, { maxLineBytes: 1.5 },
    { maxLineBytes: NaN }, { maxLineBytes: Infinity },
    { maxLineBytes: MAX_JSON_LINE_BYTES + 1 }, { maxChunkBytes: 0 },
    { maxChunkBytes: MAX_INPUT_CHUNK_BYTES + 1 },
  ]) await rejectsCode(collect([], options), "JSONL_INVALID_LIMIT");
});

test("snapshots a chunk while the consumer processes its first line", async () => {
  const sourceChunk = Buffer.from('{}\n{"id":"second"}\n');
  const iterator = parseJsonLines([sourceChunk]);
  assert.equal((await iterator.next()).value, "{}");
  sourceChunk.fill(0x78);
  assert.equal((await iterator.next()).value, '{"id":"second"}');
  assert.equal((await iterator.next()).done, true);
});

test("propagates a source failure after an emitted line without replay", async () => {
  const failure = new Error("source failed");
  let closed = false;
  async function* source() {
    try {
      yield Buffer.from('{"id":1}\n');
      throw failure;
    } finally {
      closed = true;
    }
  }
  const iterator = parseJsonLines(source());
  assert.equal((await iterator.next()).value, '{"id":1}');
  await assert.rejects(iterator.next(), (error) => error === failure);
  assert.equal(closed, true);
  assert.equal((await iterator.next()).done, true);
});
