import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import parser from "stream-json/parser.js";
import { DetailSelector, detailRequest } from "./item-detail-selector.js";
const wanted = detailRequest({
  threadId: "thread",
  turnId: "turn",
  itemId: "item",
  expectedType: "mcpToolCall",
});
const wire = (item: string, tail = "") =>
  ' {"id":1,"result":{}}\n{"id":2,"result":{"thread":{"id":"thread","turns":[{"id":"turn","items":[' +
  item +
  "]}]}}" +
  tail +
  "}";
const item =
  '{"type":"mcpToolCall","id":"item","arguments":{"n":123456789012345678901234567890,"e":1E+200,"minus":-0,"\\ud800":"\\udfff","pair":"\\ud83d\\ude00","literal":"😀"}}';
async function select(source: string, width: number) {
  const p = parser.asStream({
    jsonStreaming: true,
    packKeys: false,
    packStrings: false,
    packNumbers: false,
    writableObjectMode: true,
    writableHighWaterMark: 1,
    readableHighWaterMark: 16,
  });
  const selector = new DetailSelector(
    wanted,
    () => {},
    () => {},
  );
  const out: Buffer[] = [];
  Readable.from(
    (function* () {
      for (let i = 0; i < source.length; i += width)
        yield source.slice(i, i + width);
    })(),
    { objectMode: true, highWaterMark: 1 },
  ).pipe(p);
  for await (const token of p) out.push(...selector.consume(token));
  selector.end();
  return Buffer.concat(out).toString();
}
test("token replay preserves paired/lone surrogates, keys and numeric lexemes at every chunk width", async () => {
  for (let width = 1; width <= wire(item).length; width++) {
    const result = await select(wire(item), width);
    assert.deepEqual(JSON.parse(result).item, JSON.parse(item));
    assert(result.includes("123456789012345678901234567890"));
    assert(result.includes("1E+200"));
    assert(result.includes('"minus":-0'));
  }
});
test("strict four-field request contract", () => {
  for (const body of [
    null,
    {},
    { ...wanted, extra: 1 },
    { ...wanted, itemId: "" },
    { ...wanted, turnId: "x\n" },
    { ...wanted, threadId: "x".repeat(513) },
    { ...wanted, expectedType: "unknown" },
  ])
    assert.throws(() => detailRequest(body), { statusCode: 400 });
});
test("full response tail and all path identities must validate", async () => {
  const cases = [
    wire(item, ',"error":{"code":-32601,"message":"secret"}'),
    wire(item, ',"id":2'),
    wire(item, ',"method":"notification"'),
    wire(item).slice(0, -1),
    wire(item).replace('"id":2,"result"', '"result"'),
    wire(item).replace('"id":"thread","turns"', '"turns"'),
    wire(item).replace('"id":"turn","items"', '"items"'),
    wire(
      item.replace(
        '"type":"mcpToolCall","id":"item"',
        '"id":"item","type":"mcpToolCall"',
      ),
    ),
    wire(item.replace('"arguments"', '"id":"item","arguments"')),
    wire(item).replace('"id":"thread"', '"id":"other"'),
    wire(item.replace('"mcpToolCall"', '"fileChange"')),
    wire(item.replace('"item"', '"absent"')),
    wire(item) + "]",
  ];
  for (const source of cases) await assert.rejects(select(source, 3));
});
test("three native kinds and non-target discard", async () => {
  for (const type of [
    "commandExecution",
    "mcpToolCall",
    "fileChange",
  ] as const) {
    const s = new DetailSelector(
      { ...wanted, expectedType: type },
      () => {},
      () => {},
    );
    const p = parser.asStream({
      jsonStreaming: true,
      packKeys: false,
      packStrings: false,
      packNumbers: false,
    });
    const source = wire(
      '{"type":"agentMessage","id":"other","text":"UNRELATED"},{"type":"' +
        type +
        '","id":"item","body":"complete"}',
    );
    p.end(source);
    const out: Buffer[] = [];
    for await (const token of p) out.push(...s.consume(token));
    s.end();
    const result = Buffer.concat(out).toString();
    assert(!result.includes("UNRELATED"));
    assert.equal(JSON.parse(result).item.type, type);
  }
});
test("protocol errors are sanitized and unsupported stays 501", async () => {
  await assert.rejects(
    select(
      '{"id":1,"result":{}} {"id":2,"error":{"code":-32601,"message":"SECRET"}}',
      1,
    ),
    { statusCode: 501, message: "DETAIL_UNSUPPORTED" },
  );
  await assert.rejects(
    select(
      '{"id":1,"result":{}} {"id":2,"error":{"code":-32602,"message":"SECRET"}}',
      1,
    ),
    { statusCode: 502, message: "DETAIL_NATIVE_ERROR" },
  );
});
test("array paths reject primitive elements even when a valid target follows", async () => {
  await assert.rejects(
    select(wire(item).replace('"items":[', '"items":[null,'), 1),
    { statusCode: 502 },
  );
  await assert.rejects(
    select(wire(item).replace('"turns":[', '"turns":[false,'), 1),
    { statusCode: 502 },
  );
});
test("native notifications with emittedAtMs are discarded without blocking the read response", async () => {
  const notification =
    '{"method":"configWarning","params":{"summary":"discard","details":null},"emittedAtMs":1234567890123}\n';
  assert.equal(
    JSON.parse(await select(notification + wire(item), 2)).item.id,
    "item",
  );
});

test("request rejects coerced type arrays and C1 control characters", () => {
  assert.throws(
    () => detailRequest({ ...wanted, expectedType: ["mcpToolCall"] }),
    { statusCode: 400 },
  );
  assert.throws(() => detailRequest({ ...wanted, itemId: "bad\u0085id" }), {
    statusCode: 400,
  });
});
test("source-supported unknown-method native error remains explicit unsupported", async () => {
  await assert.rejects(
    select(
      '{"id":1,"result":{}} {"id":2,"error":{"code":-32600,"message":"unknown variant `thread/read`, expected initialize"}}',
      1,
    ),
    { statusCode: 501 },
  );
});

test("unknown RPC IDs, init errors, partial identities and depth/header limits fail safely", async () => {
  const negatives = [
    ["unknown init id", '{"id":99,"result":{}}'],
    ["unknown read id", wire(item).replace('"id":2', '"id":99')],
    [
      "initialization error",
      '{"id":1,"error":{"code":-32602,"message":"PRIVATE_INIT_ERROR"}}',
    ],
    [
      "partial thread identity",
      '{"id":1,"result":{}} {"id":2,"result":{"thread":{"id":"th',
    ],
    ["partial item identity", wire(item).split('"id":"item"')[0] + '"id":"it'],
    [
      "oversized thread identity",
      wire(item).replace('"id":"thread"', '"id":"' + "t".repeat(513) + '"'),
    ],
    [
      "oversized item identity",
      wire(item.replace('"id":"item"', '"id":"' + "i".repeat(513) + '"')),
    ],
    [
      "oversized item type",
      wire(
        item.replace(
          '"type":"mcpToolCall"',
          '"type":"' + "m".repeat(513) + '"',
        ),
      ),
    ],
    [
      "depth limit",
      wire(
        '{"type":"mcpToolCall","id":"item","nested":' +
          "[".repeat(129) +
          "0" +
          "]".repeat(129) +
          "}",
      ),
    ],
  ];
  for (const [label, source] of negatives)
    await assert.rejects(select(source!, 3), label);
  await assert.rejects(
    select(
      '{"id":1,"error":{"code":-32602,"message":"PRIVATE_INIT_ERROR"}}',
      1,
    ),
    { statusCode: 502, message: "DETAIL_NATIVE_ERROR" },
  );
  await assert.rejects(
    select(
      '{"id":1,"error":{"code":-32601,"message":"PRIVATE_UNSUPPORTED"}}',
      1,
    ),
    { statusCode: 501, message: "DETAIL_UNSUPPORTED" },
  );
});
