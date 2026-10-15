import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, get } from "node:https";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { createOriginListener } from "../refresh-prototype/origin-listener.mjs";

let root, tls;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "ck-origin-test-"));
  await promisify(execFile)(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(root, "key.pem"),
      "-out",
      join(root, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=private-listener.invalid",
    ],
    { maxBuffer: 16384 },
  );
  tls = {
    key: await readFile(join(root, "key.pem")),
    cert: await readFile(join(root, "cert.pem")),
  };
});
after(() => rm(root, { recursive: true, force: true }));
function read(port, path = "/") {
  return new Promise((resolve, reject) => {
    get(
      { hostname: "127.0.0.1", port, path, rejectUnauthorized: false },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.once("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
          }),
        );
      },
    ).once("error", reject);
  });
}
async function parentServer(t) {
  const parent = createServer(tls, (request, response) => {
    response.writeHead(200, {
      "content-security-policy": "default-src 'self'",
      "cache-control": "no-store",
      "set-cookie": "fixture=local; Path=/native-codex/; Secure; HttpOnly",
    });
    response.end(
      JSON.stringify({
        host: request.headers.host,
        path: request.url,
        port: request.socket.localPort,
      }),
    );
  });
  await new Promise((resolve) => parent.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => parent.close(resolve)));
  return parent;
}
test("independent HTTPS origins reuse the actual frontend handler, Host, cookies and CSP without rewriting", async (t) => {
  const parent = await parentServer(t),
    original = parent.address().port;
  const a = await createOriginListener({
      parent,
      tls,
      host: "127.0.0.1",
      port: 0,
    }),
    b = await createOriginListener({ parent, tls, host: "127.0.0.1", port: 0 });
  t.after(() => Promise.all([a.close(), b.close()]));
  assert.equal(new Set([original, a.port, b.port]).size, 3);
  const result = await read(a.port, "/native-codex/?fixture=1");
  assert.deepEqual(JSON.parse(result.body), {
    host: `127.0.0.1:${a.port}`,
    path: "/native-codex/?fixture=1",
    port: a.port,
  });
  assert.equal(result.headers["content-security-policy"], "default-src 'self'");
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(result.headers["set-cookie"], [
    "fixture=local; Path=/native-codex/; Secure; HttpOnly",
  ]);
  await a.close();
  assert.equal((await read(original)).status, 200);
  assert.equal((await read(b.port)).status, 200);
});
test("closing one origin closes only its network clients and retains other frontend and WebSocket connections", async (t) => {
  const parent = await parentServer(t),
    wss = new WebSocketServer({
      noServer: true,
      maxPayload: 2 * 1024 * 1024,
      perMessageDeflate: false,
    });
  parent.on("upgrade", (request, socket, head) =>
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on("message", (bytes) => ws.send(bytes));
    }),
  );
  t.after(() => wss.close());
  const a = await createOriginListener({
      parent,
      tls,
      host: "127.0.0.1",
      port: 0,
    }),
    b = await createOriginListener({ parent, tls, host: "127.0.0.1", port: 0 });
  t.after(() => Promise.all([a.close(), b.close()]));
  const first = new WebSocket(`wss://127.0.0.1:${a.port}/`, {
      rejectUnauthorized: false,
    }),
    second = new WebSocket(`wss://127.0.0.1:${b.port}/`, {
      rejectUnauthorized: false,
    });
  await Promise.all([once(first, "open"), once(second, "open")]);
  const closed = once(first, "close");
  await a.close();
  await closed;
  const echo = once(second, "message");
  second.send("unchanged native transport");
  assert.equal((await echo)[0].toString(), "unchanged native transport");
  const secondClosed = once(second, "close");
  second.close();
  await secondClosed;
});
test("invalid or occupied listeners never replace or stop the existing frontend", async (t) => {
  const parent = await parentServer(t),
    port = parent.address().port;
  for (const change of [
    { host: "localhost" },
    { port: -1 },
    { port: 65536 },
    { maxConnections: Infinity },
    { closeTimeoutMs: 0 },
  ])
    await assert.rejects(
      createOriginListener({
        parent,
        tls,
        host: "127.0.0.1",
        port: 0,
        ...change,
      }),
      /required/,
    );
  await assert.rejects(
    createOriginListener({ parent, tls, host: "127.0.0.1", port }),
    { code: "EADDRINUSE" },
  );
  assert.equal((await read(port)).status, 200);
  assert.equal(parent.listenerCount("close"), 0);
});
test(
  "a frontend which closes during listener startup cannot publish a surviving origin",
  { timeout: 2000 },
  async (t) => {
    const parent = await parentServer(t);
    const started = createOriginListener({
      parent,
      tls,
      host: "127.0.0.1",
      port: 0,
    });
    parent.close();
    await assert.rejects(started, /frontend closed/);
  },
);
test(
  "an uncooperative TLS client cannot keep an owned origin alive after its close deadline",
  { timeout: 2000 },
  async (t) => {
    const { connect } = await import("node:net");
    const parent = await parentServer(t),
      origin = await createOriginListener({
        parent,
        tls,
        host: "127.0.0.1",
        port: 0,
        closeTimeoutMs: 30,
      });
    t.after(() => origin.close());
    const socket = connect({
      host: "127.0.0.1",
      port: origin.port,
      allowHalfOpen: true,
    });
    t.after(() => socket.destroy());
    await once(socket, "connect");
    const closed = once(socket, "close");
    await origin.close();
    await assert.rejects(read(origin.port), { code: "ECONNREFUSED" });
    socket.destroy();
    await closed;
    assert.equal((await read(parent.address().port)).status, 200);
  },
);

test("HTTP2 frontends keep their actual request handler and negotiated protocol at the new origin", async (t) => {
  const { createSecureServer, connect } = await import("node:http2");
  const parent = createSecureServer(
    { ...tls, allowHTTP1: true },
    (request, response) => {
      response.writeHead(200, {
        "content-security-policy": "default-src 'self'",
      });
      response.end(
        JSON.stringify({
          host: request.headers[":authority"] ?? request.headers.host,
          version: request.httpVersion,
        }),
      );
    },
  );
  await new Promise((resolve) => parent.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => parent.close(resolve)));
  const origin = await createOriginListener({
    parent,
    tls,
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => origin.close());
  const client = connect(`https://127.0.0.1:${origin.port}`, {
    rejectUnauthorized: false,
  });
  t.after(() => client.destroy());
  const request = client.request({ ":path": "/native-codex/" });
  let data = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => (data += chunk));
  await once(request, "end");
  assert.deepEqual(JSON.parse(data), {
    host: `127.0.0.1:${origin.port}`,
    version: "2.0",
  });
  client.close();
});

test(
  "HTTP2 origins preserve the original WebSocket payload limit and upgrade headers",
  { timeout: 5000 },
  async (t) => {
    const { createSecureServer } = await import("node:http2");
    const parent = createSecureServer(
      { ...tls, allowHTTP1: true },
      (_request, response) => response.end("owned frontend"),
    );
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 2 * 1024 * 1024,
      perMessageDeflate: false,
    });
    let headers;
    const nativeError = new Promise((resolve) =>
      wss.once("connection", (ws, request) => {
        headers = request.headers;
        ws.once("error", resolve);
      }),
    );
    parent.on("upgrade", (request, socket, head) =>
      wss.handleUpgrade(request, socket, head, (ws) =>
        wss.emit("connection", ws, request),
      ),
    );
    await new Promise((resolve) => parent.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => parent.close(resolve)));
    t.after(() => wss.close());
    const origin = await createOriginListener({
      parent,
      tls,
      host: "127.0.0.1",
      port: 0,
    });
    t.after(() => origin.close());
    const client = new WebSocket(
      `wss://127.0.0.1:${origin.port}/native-codex/`,
      { rejectUnauthorized: false, origin: `https://127.0.0.1:${origin.port}` },
    );
    t.after(() => client.terminate());
    await once(client, "open");
    assert.equal(headers.host, `127.0.0.1:${origin.port}`);
    assert.equal(headers.origin, `https://127.0.0.1:${origin.port}`);
    const closed = once(client, "close");
    client.send(Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.equal((await nativeError).code, "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
    assert.equal((await closed)[0], 1009);
  },
);
