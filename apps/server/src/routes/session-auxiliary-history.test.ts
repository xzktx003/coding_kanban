import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "./session-mode.js";

const PAGE_BYTES = 2 * 1024 * 1024;
type Provider = "cc" | "acp";
const path = (provider: Provider) =>
  provider === "cc" ? "/api/cc/session-messages" : "/api/acp/session";
const cursor = (
  provider: Provider,
  session = "fixture",
  version = 1,
  before = "first",
) =>
  Buffer.from(JSON.stringify([version, provider, session, before])).toString(
    "base64url",
  );
function page(provider: Provider) {
  return {
    data:
      provider === "cc"
        ? [
            {
              uuid: "first",
              type: "assistant",
              session_id: "fixture",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "retained answer" }],
              },
            },
          ]
        : [
            {
              id: "acp-8-0",
              role: "agent",
              text: "retained answer",
              historySourceId: 8,
            },
          ],
    nextCursor: null as string | null,
    revision: provider === "cc" ? "a".repeat(64) : "3:8",
    truncated: false,
    projection: provider === "cc" ? "cc-messages" : "acp-entries",
    ...(provider === "acp"
      ? {
          metadata: {
            historySourceId: 8,
            currentModeId: "ask",
            configOptions: [],
          },
        }
      : {}),
  };
}
function fixture(fetcher: typeof fetch) {
  const app = Fastify();
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    fetch: fetcher,
  });
  return app;
}
const send = (
  app: ReturnType<typeof fixture>,
  provider: Provider,
  body: Record<string, unknown> = {},
  query = "?view=recent",
) =>
  app.inject({
    method: "POST",
    url: `/api/session${path(provider)}${query}`,
    payload: { session_id: "fixture", limit: 128, ...body },
  });

for (const provider of ["cc", "acp"] as const) {
  test(`${provider} current projected pages preserve the exact source, cursor and metadata`, async (t) => {
    const value = page(provider);
    value.nextCursor = cursor(
      provider,
      "fixture",
      1,
      provider === "cc" ? "first" : "acp-8-0",
    );
    const app = fixture(async (url, options) => {
      assert.equal(
        String(url),
        `http://127.0.0.1:12345${path(provider)}?view=recent`,
      );
      assert.deepEqual(JSON.parse(String(options?.body)), {
        session_id: "fixture",
        limit: 128,
      });
      return Response.json(value);
    });
    t.after(() => app.close());
    const response = await send(app, provider);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), value);
  });

  test(`${provider} metadata probes accept only the actual empty envelope`, async (t) => {
    const value = {
      data: [],
      nextCursor: null,
      revision: page(provider).revision,
      truncated: false,
      projection: page(provider).projection,
    };
    const app = fixture(async () => Response.json(value));
    t.after(() => app.close());
    const response = await send(app, provider, { metadataOnly: true });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), value);
  });

  test(`${provider} encoded spellings of the same recent route retain the projection guard`, async (t) => {
    const app = fixture(async () =>
      Response.json([{ content: "PRIVATE_ENCODED_BODY" }]),
    );
    t.after(() => app.close());
    for (const pathname of provider === "cc"
      ? ["/api/%63c/session-messages", "/api/cc/session%2dmessages"]
      : ["/api/%61cp/session", "/api/acp/%73ession"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/session${pathname}?view=recent`,
        payload: { session_id: "fixture" },
      });
      assert.equal(response.statusCode, 501, response.body);
      assert.equal(response.body.includes("PRIVATE_ENCODED_BODY"), false);
    }
  });

  for (const metadataOnly of [false, true]) {
    for (const large of [false, true]) {
      test(`${provider} rejects ${large ? "oversized" : "small"} legacy raw ${metadataOnly ? "metadata" : "body"} responses before delivery`, async (t) => {
        const marker = "PRIVATE_LEGACY_TOOL_RESULT";
        const app = fixture(async () =>
          Response.json([
            { content: marker + (large ? "x".repeat(PAGE_BYTES) : "") },
          ]),
        );
        t.after(() => app.close());
        const response = await send(app, provider, { metadataOnly });
        assert.equal(
          response.statusCode,
          large ? 502 : 501,
          response.body.slice(0, 512),
        );
        assert.equal(
          response.json().code,
          large
            ? "AUXILIARY_HISTORY_LIMIT_EXCEEDED"
            : "AUXILIARY_HISTORY_UNSUPPORTED",
        );
        assert.ok(response.body.length < 1024);
        assert.equal(response.body.includes(marker), false);
      });
    }
  }

  test(`${provider} metadata probes reject body fields and hidden envelope extras`, async (t) => {
    let value: unknown = page(provider);
    const app = fixture(async () => Response.json(value));
    t.after(() => app.close());
    for (const extra of [
      { data: page(provider).data },
      { metadata: { text: "PRIVATE" } },
      { raw: "PRIVATE" },
    ]) {
      value = {
        data: [],
        nextCursor: null,
        revision: page(provider).revision,
        truncated: false,
        projection: page(provider).projection,
        ...extra,
      };
      const response = await send(app, provider, { metadataOnly: true });
      assert.equal(response.statusCode, 502, response.body);
      assert.equal(response.json().code, "AUXILIARY_HISTORY_INVALID");
      assert.equal(response.body.includes("PRIVATE"), false);
    }
  });

  test(`${provider} rejects wrong projection, revision, source, rows and cursor version/identity`, async (t) => {
    let value: unknown;
    const app = fixture(async () => Response.json(value));
    t.after(() => app.close());
    const malformed: unknown[] = [
      { ...page(provider), projection: "raw" },
      { ...page(provider), revision: "" },
      { ...page(provider), truncated: "false" },
      { ...page(provider), nextCursor: cursor(provider, "other") },
      { ...page(provider), nextCursor: cursor(provider, "fixture", 2) },
      {
        ...page(provider),
        nextCursor: cursor(provider === "cc" ? "acp" : "cc"),
      },
      { ...page(provider), nextCursor: "invalid" },
      { ...page(provider), data: [null] },
      {
        ...page(provider),
        data: Array.from({ length: 129 }, () => page(provider).data[0]),
      },
      provider === "cc"
        ? { ...page(provider), data: [{ uuid: "first", session_id: "other" }] }
        : {
            ...page(provider),
            data: [
              {
                id: "acp-8-0",
                role: "agent",
                text: "wrong source",
                historySourceId: 9,
              },
            ],
          },
      ...(provider === "acp"
        ? [
            { ...page(provider), metadata: { historySourceId: 7 } },
            {
              ...page(provider),
              data: [{ sessionUpdate: "agent_message_chunk" }],
            },
          ]
        : []),
    ];
    for (value of malformed) {
      const response = await send(app, provider);
      assert.equal(
        response.statusCode,
        502,
        JSON.stringify({ value, response: response.body }),
      );
      assert.equal(response.json().code, "AUXILIARY_HISTORY_INVALID");
    }
  });

  test(`${provider} original raw API remains byte-for-byte compatible`, async (t) => {
    const raw = JSON.stringify([
      { content: "RAW_COMPATIBILITY" + "x".repeat(PAGE_BYTES) },
    ]);
    const app = fixture(
      async () =>
        new Response(raw, { headers: { "content-type": "application/json" } }),
    );
    t.after(() => app.close());
    const response = await send(app, provider, {}, "");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, raw);
  });
}

test("Claude projected SDK rows preserve nullable and absent messages without narrowing SDK types", async (t) => {
  const value = {
    ...page("cc"),
    data: [
      { uuid: "sdk-null", type: "system", message: null },
      { uuid: "sdk-absent" },
    ],
  };
  const app = fixture(async () => Response.json(value));
  t.after(() => app.close());
  const response = await send(app, "cc");
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), value);
});

test("oversized recent reads cancel upstream before consuming the remaining body", async (t) => {
  let cancelled = false,
    pulls = 0;
  const app = fixture(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(256 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  t.after(() => app.close());
  const response = await send(app, "cc");
  assert.equal(response.statusCode, 502, response.body);
  assert.equal(response.json().code, "AUXILIARY_HISTORY_LIMIT_EXCEEDED");
  assert.equal(cancelled, true);
  assert.ok(pulls <= 10, `read ${pulls} chunks from an unbounded response`);
});

test("upstream errors remain bounded and unsupported capability is explicit", async (t) => {
  let status = 404;
  const app = fixture(async () =>
    Response.json({ error: "PRIVATE_ERROR_BODY" }, { status }),
  );
  t.after(() => app.close());
  for (status of [400, 401, 403, 404, 409, 429, 501, 503]) {
    const response = await send(app, "cc");
    assert.equal(
      response.statusCode,
      [404, 501].includes(status) ? 501 : status,
    );
    assert.equal(response.body.includes("PRIVATE_ERROR_BODY"), false);
    assert.ok(response.body.length < 1024);
  }
});

for (const phase of ["headers", "body"] as const) {
  test(
    `abandoning a completed recent POST cancels its own upstream ${phase} wait`,
    { timeout: 5000 },
    async (t) => {
      let admitted!: () => void, aborted!: () => void;
      const started = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      const cancelled = new Promise<void>((resolve) => {
        aborted = resolve;
      });
      const app = fixture(async (_url, options) => {
        const signal = options!.signal!;
        if (phase === "headers")
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted();
                reject(new Error("fixture cancelled"));
              },
              { once: true },
            );
            admitted();
          });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"data":['));
              admitted();
            },
            cancel() {
              aborted();
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      });
      const controller = new AbortController();
      t.after(async () => {
        controller.abort();
        await app.close();
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const request = fetch(
        `${app.listeningOrigin}/api/session${path("cc")}?view=recent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: "fixture" }),
          signal: controller.signal,
        },
      ).catch(() => null);
      await started;
      controller.abort();
      await request;
      await cancelled;
    },
  );
}
