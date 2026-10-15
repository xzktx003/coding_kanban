import parser from "stream-json/parser.js";
import { DetailSelector } from "./item-detail-selector.js";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { readItemDetail } from "./item-detail.js";
import { EventHub } from "../core/events.js";
import { detailRequest } from "./item-detail-selector.js";
const wanted = detailRequest({
  threadId: "thread",
  turnId: "turn",
  itemId: "item",
  expectedType: "commandExecution",
});
const prefix =
  '{"id":2,"result":{"thread":{"id":"thread","turns":[{"id":"turn","items":[';
const target =
  '{"type":"commandExecution","id":"item","aggregatedOutput":"full"}';
const suffix = "]}]}}}";
const program = String.raw`
const readline=require('node:readline');const {once}=require('node:events');
const cfg=JSON.parse(process.argv[1]);let queue=Promise.resolve();
async function out(s){if(!process.stdout.write(s))await once(process.stdout,'drain');}
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{queue=queue.then(async()=>{const r=JSON.parse(line);
if(r.method==='initialize'){if(cfg.noInit)return;await out('{"id":1,"result":{}}\n');}
else if(r.method==='initialized'){}
else if(r.method==='thread/read'){
 for(const part of cfg.parts){if(typeof part==='string')await out(part);else if(part.delay)await new Promise(r=>setTimeout(r,part.delay));else if(part.raw)await out(Buffer.from(part.raw));else for(let i=0;i<part.count;i++)await out(part.text);}
 if(cfg.exit)process.exit(0);
}else process.exit(88);
});});
rl.on('close',()=>{if(cfg.closeDelay){process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),cfg.closeDelay);}else process.exit(0);});
`;
function options(parts: unknown[], extra: Record<string, unknown> = {}) {
  return {
    hub: new EventHub(),
    instance: "synthetic-detail",
    env: { PATH: "/usr/bin:/bin" },
    launch: {
      command: process.execPath,
      args: ["-e", program, JSON.stringify({ parts, ...extra })],
    },
  };
}
async function collect(body: AsyncIterable<Buffer>) {
  const out: Buffer[] = [];
  for await (const part of body) out.push(part);
  return Buffer.concat(out).toString();
}

test("independent reader discards >64 MiB and dense records with bounded actual parser input", async () => {
  const large = 68 * 1024 * 1024;
  const read = await readItemDetail(
    options([
      prefix,
      '{"type":"agentMessage","id":"other","text":"UNRELATED_SENTINEL',
      { text: "x".repeat(4096), count: large / 4096 },
      '"},',
      { text: '{"type":"agentMessage","id":"tiny","text":"x"},', count: 50000 },
      target,
      suffix,
    ]),
    wanted,
    new AbortController().signal,
  );
  const out = await collect(read.body);
  await read.finished;
  assert.equal(JSON.parse(out).item.aggregatedOutput, "full");
  assert(!out.includes("UNRELATED_SENTINEL"));
  assert(out.length < 300);
  assert(read.metrics.inputBytes > 64 * 1024 * 1024);
  assert(read.metrics.maxInputChunk <= 4096);
  assert(read.metrics.maxParserQueue <= 16);
  assert(read.metrics.maxOutputQueue <= 65536 + 24576);
  assert(read.metrics.childExited);
  console.log("DETAIL_DISCARD_METRICS", JSON.stringify(read.metrics));
});
test("complete selected large output obeys downstream backpressure and releases slot only after held exit", async () => {
  const controller = new AbortController();
  const size = 12 * 1024 * 1024;
  const read = await readItemDetail(
    options(
      [
        prefix,
        '{"type":"commandExecution","id":"item","aggregatedOutput":"',
        { text: "y".repeat(4096), count: size / 4096 },
        '"}',
        suffix,
      ],
      { closeDelay: 800 },
    ),
    wanted,
    controller.signal,
  );
  await new Promise((r) => setTimeout(r, 200));
  assert(read.metrics.inputBytes < 2 * 1024 * 1024);
  await assert.rejects(
    readItemDetail(options([]), wanted, new AbortController().signal),
    { statusCode: 429 },
  );
  const out = await collect(read.body);
  assert.equal(JSON.parse(out).item.aggregatedOutput.length, size);
  await assert.rejects(
    readItemDetail(options([]), wanted, new AbortController().signal),
    { statusCode: 429 },
  );
  await read.finished;
  assert(read.metrics.childExited);
  assert(read.metrics.backpressureMs >= 100);
  console.log("DETAIL_SELECTED_METRICS", JSON.stringify(read.metrics));
});
test("cancellation while blocked tears down own child and permits a later request", async () => {
  const controller = new AbortController();
  const read = await readItemDetail(
    options([
      prefix,
      '{"type":"commandExecution","id":"item","aggregatedOutput":"',
      { text: "z".repeat(4096), count: 32768 },
      '"}',
      suffix,
    ]),
    wanted,
    controller.signal,
  );
  await new Promise((r) => setTimeout(r, 100));
  controller.abort();
  await read.finished;
  assert(read.metrics.childExited);
  assert(read.body.destroyed);
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(
    readItemDetail(options([]), wanted, alreadyCancelled.signal),
    { message: "DETAIL_CANCELLED" },
  );
  const next = await readItemDetail(
    options([prefix, target, suffix]),
    wanted,
    new AbortController().signal,
  );
  assert.equal(JSON.parse(await collect(next.body)).item.id, "item");
  await next.finished;
});
test("bad UTF8 and partial bodies/tails fail without completing an envelope", async () => {
  for (const parts of [
    [
      prefix,
      '{"type":"commandExecution","id":"item","aggregatedOutput":"',
      { raw: [0xc0, 0xaf] },
      '"}',
      suffix,
    ],
    [prefix, target, suffix.slice(0, -1)],
    [prefix, target, suffix.slice(0, -1), ',"error":{"code":-32601}}'],
  ]) {
    let read;
    try {
      read = await readItemDetail(
        options(parts, { exit: true }),
        wanted,
        new AbortController().signal,
      );
      await assert.rejects(collect(read.body));
    } catch (error) {
      assert.equal((error as Error).message, "DETAIL_PROTOCOL_ERROR");
    } finally {
      await read?.finished;
    }
  }
});
test("missing target, changed type, RPC unsupported and launch failure have fixed statuses", async () => {
  for (const [parts, status] of [
    [[prefix, target.replace('"item"', '"absent"'), suffix], 404],
    [[prefix, target.replace("commandExecution", "fileChange"), suffix], 409],
    [['{"id":2,"error":{"code":-32601,"message":"secret"}}'], 501],
    [['{"id":2,"error":{"code":-32602,"message":"secret"}}'], 502],
  ] as const) {
    await assert.rejects(
      readItemDetail(options([...parts]), wanted, new AbortController().signal),
      { statusCode: status },
    );
    // Error readiness precedes final EOF cleanup; make the following fixture explicitly wait for it.
    await new Promise((r) => setTimeout(r, 100));
  }
  await assert.rejects(
    readItemDetail(
      {
        ...options([]),
        launch: { command: "/nonexistent-detail-test-binary", args: [] },
      },
      wanted,
      new AbortController().signal,
    ),
    { statusCode: 503 },
  );
});
test("abort during authorized environment resolution releases admission without spawning", async () => {
  const controller = new AbortController();
  const pending = readItemDetail(
    { ...options([]), resolveEnv: () => new Promise(() => {}) },
    wanted,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, { message: "DETAIL_CANCELLED" });
  const next = await readItemDetail(
    options([prefix, target, suffix]),
    wanted,
    new AbortController().signal,
  );
  await collect(next.body);
  await next.finished;
});
test("120 second total deadline aborts an incomplete selected response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const read = await readItemDetail(
    options([
      prefix,
      '{"type":"commandExecution","id":"item","aggregatedOutput":"',
    ]),
    wanted,
    new AbortController().signal,
  );
  const collected = collect(read.body);
  const assertion = assert.rejects(collected, { statusCode: 504 });
  t.mock.timers.tick(120001);
  t.mock.timers.reset();
  await assertion;
  await read.finished;
  assert(read.metrics.childExited);
});
test("initialization deadline is 10 seconds and cleans its held process", async () => {
  const start = performance.now();
  await assert.rejects(
    readItemDetail(
      options([], { noInit: true }),
      wanted,
      new AbortController().signal,
    ),
    { statusCode: 504 },
  );
  assert(performance.now() - start >= 10000);
});
test("15 second native stdout idle deadline fails while no downstream drain is blocked", async () => {
  const start = performance.now();
  const read = await readItemDetail(
    options([
      prefix,
      '{"type":"commandExecution","id":"item","aggregatedOutput":"',
    ]),
    wanted,
    new AbortController().signal,
  );
  await assert.rejects(collect(read.body), { statusCode: 504 });
  await read.finished;
  assert(read.metrics.childExited);
  assert(performance.now() - start >= 15000);
});

test("a slow consumer blocked for longer than idle deadline is not treated as native silence", async () => {
  const read = await readItemDetail(
    options([
      prefix,
      '{"type":"commandExecution","id":"item","aggregatedOutput":"',
      { text: "q".repeat(4096), count: 2048 },
      '"}',
      suffix,
    ]),
    wanted,
    new AbortController().signal,
  );
  await new Promise((r) => setTimeout(r, 15750));
  assert.equal(read.body.destroyed, false);
  const result = JSON.parse(await collect(read.body));
  assert.equal(result.item.aggregatedOutput.length, 8 * 1024 * 1024);
  await read.finished;
  assert(read.metrics.backpressureMs > 15000);
  assert(read.metrics.childExited);
});

test("held child ignoring EOF and TERM keeps admission until KILL and actual exit", async () => {
  const read = await readItemDetail(
    options([prefix, target, suffix], { closeDelay: 60000 }),
    wanted,
    new AbortController().signal,
  );
  await collect(read.body);
  await new Promise((r) => setTimeout(r, 2300));
  assert.equal(read.metrics.childExited, false);
  await assert.rejects(
    readItemDetail(options([]), wanted, new AbortController().signal),
    { statusCode: 429 },
  );
  await read.finished;
  assert(read.metrics.childExited);
  assert.throws(() => process.kill(read.metrics.pid!, 0), { code: "ESRCH" });
});

test("valid UTF8 byte splits and lone surrogates survive actual child stdout", async () => {
  const actual = {
    type: "commandExecution",
    id: "item",
    aggregatedOutput: "😀é汉\ud800",
    ["😀\udfff"]: "value",
  };
  const encoded = Buffer.from(prefix + JSON.stringify(actual) + suffix);
  for (const character of ["😀", "é", "汉"]) {
    const bytes = Buffer.from(character),
      offset = encoded.indexOf(bytes);
    for (let split = 1; split < bytes.length; split++) {
      const cut = offset + split;
      const reading = await readItemDetail(
        options([
          { raw: [...encoded.subarray(0, cut)] },
          { delay: 5 },
          { raw: [...encoded.subarray(cut)] },
        ]),
        wanted,
        new AbortController().signal,
      );
      assert.deepEqual(JSON.parse(await collect(reading.body)).item, actual);
      await reading.finished;
      assert(reading.metrics.childExited);
    }
  }
});

test("stalled selected output bounds dense tail feeds and huge non-target keys and numbers", async () => {
  const size = 8 * 1024 * 1024;
  const observed = {
    feeds: 0,
    maxFeedBytes: 0,
    maxFeedChars: 0,
    maxVisibleQueue: 0,
    maxWritableQueue: 0,
    maxFrames: 0,
    maxScalarChars: 0,
    maxFrameKeyChars: 0,
    maxMetadataCodeUnits: 0,
    maxTokenChunkChars: 0,
    denseStarts: 0,
  };
  const createParser = parser.asStream;
  parser.asStream = (options) => {
    const stream = createParser(options);
    const write = stream.write;
    stream.write = function (
      this: typeof stream,
      chunk: string,
      ...rest: unknown[]
    ) {
      observed.feeds++;
      observed.maxFeedBytes = Math.max(
        observed.maxFeedBytes,
        Buffer.byteLength(chunk),
      );
      observed.maxFeedChars = Math.max(observed.maxFeedChars, chunk.length);
      observed.maxVisibleQueue = Math.max(
        observed.maxVisibleQueue,
        stream.readableLength,
      );
      observed.maxWritableQueue = Math.max(
        observed.maxWritableQueue,
        stream.writableLength,
      );
      return (write as (...args: unknown[]) => boolean).call(
        this,
        chunk,
        ...rest,
      );
    } as typeof stream.write;
    return stream;
  };
  const consume = DetailSelector.prototype.consume;
  DetailSelector.prototype.consume = function (token) {
    if ("value" in token && typeof token.value === "string")
      observed.maxTokenChunkChars = Math.max(
        observed.maxTokenChunkChars,
        token.value.length,
      );
    if (token.name === "startObject") observed.denseStarts++;
    const output = consume.call(this, token);
    // Test-only inspection retains numeric maxima, never token/body references. Code units
    // describe retained selector text, not JS object allocator bytes or hidden parser tokens.
    const state = this as unknown as {
      stack: Array<{
        key: string;
        id?: string;
        type?: string;
        rpcId?: string;
        method?: string;
        code?: string;
        seen: Set<string>;
      }>;
      scalar?: { text: string };
    };
    observed.maxFrames = Math.max(observed.maxFrames, state.stack.length);
    observed.maxScalarChars = Math.max(
      observed.maxScalarChars,
      state.scalar?.text.length ?? 0,
    );
    let metadata = state.scalar?.text.length ?? 0;
    for (const frame of state.stack) {
      observed.maxFrameKeyChars = Math.max(
        observed.maxFrameKeyChars,
        frame.key.length,
      );
      metadata += [
        frame.key,
        frame.id,
        frame.type,
        frame.rpcId,
        frame.method,
        frame.code,
        ...frame.seen,
      ].reduce((sum, value) => sum + (value?.length ?? 0), 0);
    }
    observed.maxMetadataCodeUnits = Math.max(
      observed.maxMetadataCodeUnits,
      metadata,
    );
    return output;
  };
  let reading: Awaited<ReturnType<typeof readItemDetail>> | undefined;
  const controller = new AbortController();
  try {
    reading = await readItemDetail(
      options([
        prefix,
        '{"type":"commandExecution","id":"item","aggregatedOutput":"',
        { text: "y".repeat(4096), count: size / 4096 },
        '"},{"type":"agentMessage","id":"discard","dense":[',
        { text: "{},", count: 50000 },
        '{}],"',
        { text: "K".repeat(4096), count: size / 4096 },
        '":0,"number":1',
        { text: "7".repeat(4096), count: size / 4096 },
        "}",
        suffix,
      ]),
      wanted,
      controller.signal,
    );
    for (
      let attempts = 0;
      attempts < 100 && reading.metrics.maxOutputQueue < 65536;
      attempts++
    )
      await new Promise((r) => setTimeout(r, 20));
    assert(
      reading.metrics.maxOutputQueue >= 65536,
      "must actually block the output writable queue",
    );
    await new Promise((r) => setTimeout(r, 100));
    const stalledBefore = {
      nativeBytesAdmitted: reading.metrics.inputBytes,
      parserFeeds: observed.feeds,
      visibleQueue: observed.maxVisibleQueue,
      outputQueue: reading.metrics.maxOutputQueue,
    };
    await new Promise((r) => setTimeout(r, 250));
    const stalledAfter = {
      nativeBytesAdmitted: reading.metrics.inputBytes,
      parserFeeds: observed.feeds,
    };
    assert.equal(
      stalledAfter.nativeBytesAdmitted,
      stalledBefore.nativeBytesAdmitted,
    );
    assert.equal(stalledAfter.parserFeeds, stalledBefore.parserFeeds);
    assert(
      stalledAfter.nativeBytesAdmitted < size,
      "cannot read the dense/key/number tail while selected output is stalled",
    );
    const output = JSON.parse(await collect(reading.body));
    await reading.finished;
    assert.deepEqual(Object.keys(output.item), [
      "type",
      "id",
      "aggregatedOutput",
    ]);
    assert.equal(output.item.type, "commandExecution");
    assert.equal(output.item.id, "item");
    assert.equal(output.item.aggregatedOutput.length, size);
    const expected = createHash("sha256");
    for (let i = 0; i < size / 4096; i++) expected.update("y".repeat(4096));
    assert.equal(
      createHash("sha256").update(output.item.aggregatedOutput).digest("hex"),
      expected.digest("hex"),
    );
    assert(reading.metrics.inputBytes > 3 * size);
    assert(reading.metrics.maxInputChunk <= 4096);
    assert(observed.maxFeedBytes <= 4096);
    assert(observed.maxFeedChars <= 4096);
    assert(observed.maxVisibleQueue <= 16);
    assert(observed.maxWritableQueue <= 1);
    assert(observed.maxScalarChars <= 512);
    assert(observed.maxFrameKeyChars <= 512);
    assert(observed.maxFrames <= 128);
    assert(observed.denseStarts >= 50001);
    assert(observed.maxTokenChunkChars <= 4096 + 16);
    assert(reading.metrics.childExited);
    // Exact 3.7.0 source: one tokens[] per input; with packing off, each consumed
    // code unit emits at most four token objects, plus scalar completion/lookahead.
    // Six-char Unicode escapes/keywords/numeric carry fit a conservative16-char
    // allowance, plus16 pending completions. This is a source-derived upper bound,
    // NOT a measurement of tokens[] or a claim that readable HWM16 includes it.
    const currentBatchTokenBound = 4 * (4096 + 16) + 16;
    console.log(
      "DETAIL_DENSE_STALL_BOUNDS",
      JSON.stringify({
        stalledBefore,
        stalledAfter,
        selectedBytes: size,
        nonTargetKeyChars: size,
        nonTargetNumberDigits: size + 1,
        observed,
        metrics: reading.metrics,
        sourceDerivedCurrentBatchTokenBound: currentBatchTokenBound,
        parserStackBoundDuringBatch: 128 + 4096 + 16,
        selectorRetainedTextBoundCodeUnits: 128 * (3 * 512 + 64) + 512,
        transientScalarConcatBoundCodeUnits: 512 + 4096 + 16,
        measuredHiddenBatch: false,
      }),
    );
  } finally {
    controller.abort();
    await reading?.finished;
    parser.asStream = createParser;
    DetailSelector.prototype.consume = consume;
  }
});
