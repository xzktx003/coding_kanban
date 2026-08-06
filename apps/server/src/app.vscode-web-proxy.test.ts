import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import test from "node:test";

import { buildServer } from "./app.js";
import { resetVsCodeWebProxyDiagnosticsForTest } from "./routes/vscode-web-proxy.js";

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to determine server port"));
        return;
      }

      resolve(address.port);
    });
  });
}

function wsAccept(key: string): string {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function decodeClientTextFrame(frame: Buffer): string {
  const payloadLength = frame[1]! & 0x7f;
  assert.ok(payloadLength < 126);
  assert.ok((frame[1]! & 0x80) !== 0);

  const mask = frame.subarray(2, 6);
  const payload = frame.subarray(6, 6 + payloadLength);
  return Buffer.from(
    payload.map((byte, index) => byte ^ mask[index % mask.length]!),
  ).toString("utf8");
}

test("GET /vscode/* proxies HTTP requests to the active VS Code Web target", async () => {
  let receivedUrl = "";
  let receivedHost = "";
  const upstream = createServer((request, response) => {
    receivedUrl = request.url ?? "";
    receivedHost = request.headers.host ?? "";
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.setHeader("permissions-policy", "geolocation=()");
    response.end("proxied-ok");
  });
  const upstreamPort = await listen(upstream);

  const { app } = buildServer({
    vsCodeWebManager: {
      dispose: async () => {},
      getProxyTargetUrl: () => `http://127.0.0.1:${upstreamPort}`,
    } as never,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/vscode/test/path?via=proxy`,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "proxied-ok");
    assert.equal(receivedUrl, "/test/path?via=proxy");
    assert.equal(receivedHost, `127.0.0.1:${address.port}`);
    assert.equal(
      response.headers.get("permissions-policy"),
      "geolocation=(), clipboard-read=(self), clipboard-write=(self)",
    );
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("GET /vscode/* prefers browser origin host but forwards HTTP protocol to the upstream VS Code Web server", async () => {
  let receivedForwardedHost = "";
  let receivedForwardedProto = "";
  const upstream = createServer((request, response) => {
    receivedForwardedHost =
      (request.headers["x-forwarded-host"] as string | undefined) ?? "";
    receivedForwardedProto =
      (request.headers["x-forwarded-proto"] as string | undefined) ?? "";
    response.statusCode = 204;
    response.end();
  });
  const upstreamPort = await listen(upstream);

  const { app } = buildServer({
    vsCodeWebManager: {
      dispose: async () => {},
      getProxyTargetUrl: () => `http://127.0.0.1:${upstreamPort}`,
    } as never,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/vscode/`, {
      headers: {
        origin: "https://127.0.0.1:3000",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(receivedForwardedHost, "127.0.0.1:3000");
    assert.equal(receivedForwardedProto, "http");
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("GET /vscode returns 503 when no active VS Code Web target exists", async () => {
  const { app } = buildServer({
    vsCodeWebManager: {
      dispose: async () => {},
      getProxyTargetUrl: () => null,
    } as never,
  });

  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/vscode/",
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.body, /VS Code Web/);
  } finally {
    await app.close();
  }
});

test("GET /api/diagnostics/vscode-web-proxy reports proxied HTTP traffic", async () => {
  resetVsCodeWebProxyDiagnosticsForTest();

  const upstream = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("proxied-diagnostics-ok");
  });
  const upstreamPort = await listen(upstream);

  const { app } = buildServer({
    vsCodeWebManager: {
      dispose: async () => {},
      getProxyTargetUrl: () => `http://127.0.0.1:${upstreamPort}`,
    } as never,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const proxiedResponse = await fetch(
      `http://127.0.0.1:${address.port}/vscode/diagnostics.txt`,
    );
    assert.equal(proxiedResponse.status, 200);
    assert.equal(await proxiedResponse.text(), "proxied-diagnostics-ok");

    const diagnosticsResponse = await app.inject({
      method: "GET",
      url: "/api/diagnostics/vscode-web-proxy",
    });
    const diagnostics = JSON.parse(diagnosticsResponse.body);

    assert.equal(diagnosticsResponse.statusCode, 200);
    assert.equal(diagnostics.http.totalRequests, 1);
    assert.equal(diagnostics.http.lastStatusCode, 200);
    assert.ok(diagnostics.http.requestsPerSecond > 0);
    assert.ok(diagnostics.http.totalDownloadKilobytes > 0);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("/vscode proxies WebSocket upgrades to the active VS Code Web target", async () => {
  resetVsCodeWebProxyDiagnosticsForTest();

  let receivedUpgradeUrl = "";
  const upstream = createServer();
  upstream.on("upgrade", (request, socket) => {
    receivedUpgradeUrl = request.url ?? "";
    const keyHeader = request.headers["sec-websocket-key"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    assert.ok(key);

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${wsAccept(key)}`,
        "",
        "",
      ].join("\r\n"),
    );
    socket.write(Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]));
    socket.end();
  });
  const upstreamPort = await listen(upstream);

  const { app } = buildServer({
    vsCodeWebManager: {
      dispose: async () => {},
      getProxyTargetUrl: () => `http://127.0.0.1:${upstreamPort}`,
    } as never,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const receivedMessage = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${address.port}/vscode/socket?channel=1`,
      );

      socket.addEventListener("message", (event) => {
        resolve(String(event.data));
        socket.close();
      });
      socket.addEventListener("error", () => {
        reject(new Error("WebSocket proxy handshake failed"));
      });
    });

    assert.equal(receivedMessage, "hello");
    assert.equal(receivedUpgradeUrl, "/socket?channel=1");

    const diagnosticsResponse = await app.inject({
      method: "GET",
      url: "/api/diagnostics/vscode-web-proxy",
    });
    const diagnostics = JSON.parse(diagnosticsResponse.body);

    assert.equal(diagnosticsResponse.statusCode, 200);
    assert.equal(diagnostics.websocket.totalDownloadMessages, 1);
    assert.ok(diagnostics.websocket.messagesPerSecond > 0);
    assert.ok(diagnostics.websocket.totalDownloadKilobytes > 0);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("/vscode preserves client messages sent before the upstream WebSocket opens", async () => {
  let resolveUpstreamMessage: (message: string) => void = () => {};
  const upstreamSockets = new Set<Duplex>();
  const upstreamMessage = new Promise<string>((resolve) => {
    resolveUpstreamMessage = resolve;
  });
  const upstream = createServer();
  upstream.on("upgrade", (request, socket) => {
    upstreamSockets.add(socket);
    const keyHeader = request.headers["sec-websocket-key"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    assert.ok(key);

    setTimeout(() => {
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${wsAccept(key)}`,
          "",
          "",
        ].join("\r\n"),
      );
      socket.once("data", (frame) => {
        resolveUpstreamMessage(decodeClientTextFrame(frame));
      });
    }, 100);
  });
  const upstreamPort = await listen(upstream);

  const { app } = buildServer({
    vsCodeWebManager: {
      dispose: async () => {},
      getProxyTargetUrl: () => `http://127.0.0.1:${upstreamPort}`,
    } as never,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");

  let socket: WebSocket | undefined;
  try {
    socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/vscode/socket?channel=early`,
    );
    const received = await Promise.race([
      new Promise<string>((resolve, reject) => {
        socket!.addEventListener("open", () => {
          socket!.send("client-handshake");
          void upstreamMessage.then(resolve);
        });
        socket!.addEventListener("error", () => {
          reject(new Error("WebSocket proxy handshake failed"));
        });
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("Early WebSocket message was dropped")),
          1_000,
        );
      }),
    ]);
    assert.equal(received, "client-handshake");
  } finally {
    for (const upstreamSocket of upstreamSockets) {
      upstreamSocket.destroy();
    }
    socket?.close();
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
