import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { once } from "node:events";
import { createRequire } from "node:module";
import { connect as connectNet } from "node:net";
import { test } from "node:test";
import { attachSessionMemoryHmrProxy } from "../tests/e2e/helpers/session-memory-hmr-proxy.mjs";

const require = createRequire(
  new URL("../packages/session-runtime/package.json", import.meta.url),
);
const { WebSocket, WebSocketServer } = require("ws");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForClose = (ws) =>
  new Promise((resolve, reject) => {
    ws.once("close", resolve);
    ws.once("error", reject);
  });
const openOrReject = async (url, protocol, options = {}) => {
  const ws = new WebSocket(url, protocol, options);
  const result = await new Promise((resolve, reject) => {
    ws.once("open", () => reject(new Error("Unexpected websocket open")));
    ws.once("error", resolve);
    ws.once("unexpected-response", (_req, res) =>
      resolve({ statusCode: res.statusCode }),
    );
  });
  return { ws, result };
};
const createTls = () => {
  const dir = mkdtempSync(join(tmpdir(), "session-memory-hmr-"));
  const key = join(dir, "key.pem"),
    cert = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  return { dir, key: readFileSync(key), cert: readFileSync(cert) };
};
const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
const closeServer = async (server) => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
};

await test("HTTPS source bridge validates exact HMR upgrade and bounds/cleans both peers", async () => {
  const tls = createTls();
  const source = createHttpsServer({ key: tls.key, cert: tls.cert });
  const sourceWss = new WebSocketServer({
    server: source,
    maxPayload: 1024 * 1024,
  });
  let sourceConnections = 0,
    sourcePath,
    sourceProtocol,
    sourceToken,
    seenPong = false,
    binaryRequest;
  sourceWss.on("connection", (ws, req) => {
    sourceConnections++;
    sourcePath = req.url.split("?")[0];
    sourceToken = new URL(req.url, "https://localhost").searchParams.get(
      "token",
    );
    sourceProtocol = ws.protocol;
    ws.send(JSON.stringify({ type: "connected" }));
    ws.send(Buffer.from([1, 2, 3]));
    const pingTimer = setInterval(
      () => ws.send(JSON.stringify({ type: "ping" })),
      100,
    );
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        binaryRequest = [...data];
        ws.send(Buffer.alloc(2048));
        return;
      }
      if (JSON.parse(String(data)).type === "pong") seenPong = true;
    });
    ws.on("close", () => clearInterval(pingTimer));
  });
  const sourcePort = await listen(source);
  const proxy = createHttpServer();
  const proxyPort = await listen(proxy);
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  let verifies = 0,
    verifyMode = "ok",
    modeCalls = 0;
  const bridge = attachSessionMemoryHmrProxy({
    server: proxy,
    sourceOrigin: `https://localhost:${sourcePort}`,
    proxyOrigin,
    verifySource: async (signal) => {
      verifies++;
      if (signal.aborted) throw new Error("aborted");
      if (verifyMode === "reject-before") return false;
      if (verifyMode === "reject-after" && ++modeCalls === 2) return false;
      return true;
    },
    rejectUnauthorized: false,
    maxFrameBytes: 1024,
    maxBufferedBytes: 4096,
    handshakeTimeoutMs: 500,
  });
  try {
    const invalid = [
      [
        `ws://127.0.0.1:${proxyPort}/other?token=x`,
        "vite-hmr",
        { origin: proxyOrigin },
      ],
      [
        `ws://127.0.0.1:${proxyPort}/?token=`,
        "vite-hmr",
        { origin: proxyOrigin },
      ],
      [
        `ws://127.0.0.1:${proxyPort}/?token=x&other=y`,
        "vite-hmr",
        { origin: proxyOrigin },
      ],
      [
        `ws://127.0.0.1:${proxyPort}/?token=x&token=y`,
        "vite-hmr",
        { origin: proxyOrigin },
      ],
      [
        `ws://127.0.0.1:${proxyPort}/?token=x`,
        "not-vite-hmr",
        { origin: proxyOrigin },
      ],
      [
        `ws://127.0.0.1:${proxyPort}/?token=x`,
        "vite-hmr",
        { origin: "http://evil.invalid" },
      ],
      [
        `ws://127.0.0.1:${proxyPort}/?token=x`,
        "vite-hmr",
        { origin: proxyOrigin, headers: { host: "evil.invalid" } },
      ],
    ];
    for (const [url, protocol, options] of invalid)
      await openOrReject(url, protocol, options);
    assert.equal(
      sourceConnections,
      0,
      "rejected requests must not reach upstream",
    );
    const beforeMalformed = verifies;
    for (const requestTarget of [
      `http://evil.invalid/?token=x`,
      `//evil.invalid/?token=x`,
    ]) {
      const raw = connectNet(proxyPort, "127.0.0.1");
      const responseReceived = once(raw, "data");
      raw.write(
        `GET ${requestTarget} HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr\r\nOrigin: ${proxyOrigin}\r\n\r\n`,
      );
      const [response] = await responseReceived;
      assert.match(String(response), /^HTTP\/1\.1 403/);
      raw.destroy();
    }
    assert.equal(
      verifies,
      beforeMalformed,
      "non-origin-form request targets must not invoke source verification",
    );

    verifyMode = "reject-before";
    const upstreamsBeforeIdentityReject = sourceConnections;
    await openOrReject(`ws://127.0.0.1:${proxyPort}/?token=x`, "vite-hmr", {
      origin: proxyOrigin,
    });
    for (let i = 0; i < 30 && bridge.snapshot().active; i++) await sleep(10);
    assert.equal(
      sourceConnections,
      upstreamsBeforeIdentityReject,
      "failed preflight identity must not connect upstream",
    );
    assert.equal(bridge.snapshot().rawActive, 0);

    verifyMode = "reject-after";
    modeCalls = 0;
    await openOrReject(`ws://127.0.0.1:${proxyPort}/?token=x`, "vite-hmr", {
      origin: proxyOrigin,
    });
    for (
      let i = 0;
      i < 50 &&
      (bridge.snapshot().active ||
        bridge.snapshot().upstreamActive ||
        bridge.snapshot().rawActive);
      i++
    )
      await sleep(10);
    assert.equal(
      sourceConnections,
      upstreamsBeforeIdentityReject + 1,
      "post-handshake identity check must reach then reject the fixed upstream",
    );
    assert.equal(bridge.snapshot().active, 0);
    assert.equal(bridge.snapshot().upstreamActive, 0);
    assert.equal(bridge.snapshot().rawActive, 0);
    verifyMode = "ok";

    const client = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/?token=fixture-secret`,
      "vite-hmr",
      { origin: proxyOrigin },
    );
    const received = [];
    let binaryEcho;
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        binaryEcho = [...data];
        return;
      }
      const message = JSON.parse(String(data));
      received.push(message.type);
      if (message.type === "ping")
        client.send(JSON.stringify({ type: "pong" }));
    });
    await once(client, "open");
    for (let i = 0; i < 40 && !seenPong; i++) await sleep(20);
    await sleep(600);
    assert.ok(received.includes("connected"));
    assert.ok(received.includes("ping"));
    assert.equal(seenPong, true);
    assert.deepEqual(binaryEcho, [1, 2, 3]);
    assert.equal(sourcePath, "/");
    assert.equal(sourceProtocol, "vite-hmr");
    assert.equal(sourceToken, "fixture-secret");
    assert.equal(client.readyState, WebSocket.OPEN);
    assert.ok(verifies >= 2);
    assert.equal(bridge.snapshot().active, 1);
    assert.ok(bridge.snapshot().fromClient.pong >= 1);
    client.send(Buffer.from([9, 8, 7]));
    await waitForClose(client);
    assert.deepEqual(binaryRequest, [9, 8, 7]);
    for (let i = 0; i < 50 && bridge.snapshot().active; i++) await sleep(10);
    assert.equal(
      bridge.snapshot().active,
      0,
      "oversized upstream frame must release both peers",
    );
    assert.equal(bridge.snapshot().rejected, invalid.length + 4);
  } finally {
    await bridge.close();
    for (const ws of sourceWss.clients) ws.terminate();
    await new Promise((resolve) => sourceWss.close(resolve));
    await closeServer(proxy);
    await closeServer(source);
    rmSync(tls.dir, { recursive: true, force: true });
  }
});

await test("proxy close forcibly releases a peer that ignores the close handshake", async () => {
  const tls = createTls();
  const source = createHttpsServer({ key: tls.key, cert: tls.cert });
  const sourceWss = new WebSocketServer({ server: source });
  sourceWss.on("connection", (ws) =>
    ws.send(JSON.stringify({ type: "connected" })),
  );
  const sourcePort = await listen(source);
  const proxy = createHttpServer();
  const proxyPort = await listen(proxy);
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  const bridge = attachSessionMemoryHmrProxy({
    server: proxy,
    sourceOrigin: `https://localhost:${sourcePort}`,
    proxyOrigin,
    verifySource: async () => true,
    rejectUnauthorized: false,
    closeTimeoutMs: 100,
  });
  const raw = connectNet(proxyPort, "127.0.0.1");
  const responseReceived = once(raw, "data");
  raw.write(
    `GET /?token=x HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr\r\nOrigin: ${proxyOrigin}\r\n\r\n`,
  );
  try {
    const [response] = await responseReceived;
    assert.match(String(response), /^HTTP\/1\.1 101/);
    assert.equal(bridge.snapshot().active, 1);
    const started = Date.now();
    await bridge.close();
    assert.ok(
      Date.now() - started < 500,
      "close must be bounded when peer does not answer",
    );
    assert.equal(bridge.snapshot().active, 0);
    assert.equal(bridge.snapshot().upstreamActive, 0);
    assert.equal(bridge.snapshot().rawActive, 0);
  } finally {
    raw.destroy();
    for (const ws of sourceWss.clients) ws.terminate();
    await new Promise((resolve) => sourceWss.close(resolve));
    await closeServer(proxy);
    await closeServer(source);
    rmSync(tls.dir, { recursive: true, force: true });
  }
});

await test("HTTP source maps to ws and verifier failure/pending cancellation release raw sockets", async () => {
  const source = createHttpServer();
  const sourceWss = new WebSocketServer({ noServer: true });
  source.on("upgrade", (req, socket, head) =>
    sourceWss.handleUpgrade(req, socket, head, (ws) =>
      ws.send(JSON.stringify({ type: "connected" })),
    ),
  );
  const sourcePort = await listen(source);
  const proxy = createHttpServer();
  const proxyPort = await listen(proxy);
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  const bridge = attachSessionMemoryHmrProxy({
    server: proxy,
    sourceOrigin: `http://127.0.0.1:${sourcePort}`,
    proxyOrigin,
    verifySource: async () => true,
    handshakeTimeoutMs: 200,
  });
  try {
    const client = new WebSocket(
      `${proxyOrigin.replace("http:", "ws:")}/?token=ok`,
      "vite-hmr",
      { origin: proxyOrigin },
    );
    const connected = new Promise((resolve) =>
      client.on("message", (data) => resolve(JSON.parse(String(data)).type)),
    );
    await once(client, "open");
    assert.equal(await connected, "connected");
    client.terminate();
    await waitForClose(client);
    for (let i = 0; i < 50 && bridge.snapshot().active; i++) await sleep(10);
    assert.equal(bridge.snapshot().active, 0);
  } finally {
    await bridge.close();
    for (const ws of sourceWss.clients) ws.terminate();
    await new Promise((resolve) => sourceWss.close(resolve));
    await closeServer(proxy);
    await closeServer(source);
  }

  const pendingProxy = createHttpServer();
  const pendingPort = await listen(pendingProxy);
  const pendingOrigin = `http://127.0.0.1:${pendingPort}`;
  let aborted = false;
  const pending = attachSessionMemoryHmrProxy({
    server: pendingProxy,
    sourceOrigin: "http://127.0.0.1:9",
    proxyOrigin: pendingOrigin,
    verifySource: (signal) =>
      new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve(false);
          },
          { once: true },
        ),
      ),
    handshakeTimeoutMs: 100,
  });
  const waiting = new WebSocket(
    `ws://127.0.0.1:${pendingPort}/?token=wait`,
    "vite-hmr",
    { origin: pendingOrigin },
  );
  waiting.on("error", () => {});
  const clientClosed = new Promise((resolve) => {
    waiting.once("close", resolve);
    waiting.once("error", resolve);
  });
  await sleep(150);
  const start = Date.now();
  await pending.close();
  await Promise.race([clientClosed, sleep(300)]);
  assert.equal(aborted, true);
  assert.equal(pending.snapshot().active, 0);
  assert.ok(
    Date.now() - start < 350,
    "pending verifier teardown must be bounded",
  );
  await closeServer(pendingProxy);
});
