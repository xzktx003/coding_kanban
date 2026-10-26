import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket, { WebSocketServer } from "ws";
import {
  registerNativeCodexRoutes,
  NATIVE_CODEX_MAX_MESSAGE_BYTES,
  NATIVE_CODEX_MAX_UPSTREAM_MESSAGE_BYTES,
} from "./native-codex.js";
import { NativeCodexGateway } from "../services/native-codex-gateway.js";

const profileId = "019aabcd-1234-7890-abcd-0123456789ab";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "native-compression-"));
  const upstream = createServer((_req, res) => res.end("ok"));
  const wss = new WebSocketServer({
    server: upstream,
    perMessageDeflate: true,
  });
  const app = Fastify();
  const close = async () => {
    for (const peer of wss.clients) peer.terminate();
    await app.close();
    await new Promise<void>((done) => wss.close(() => done()));
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  };
  try {
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const address = upstream.address();
    assert.ok(address && typeof address !== "string");
    const runtimeRecord = join(dir, "runtime.json");
    await writeFile(
      runtimeRecord,
      JSON.stringify({
        port: address.port,
        protocol: "http",
        projectDir: join(dir, "project"),
        threads: [],
      }),
      {
        mode: 0o600,
      },
    );
    const gateway = new NativeCodexGateway(() => ({
      upstreamUrl: `http://127.0.0.1:${address.port}`,
      runtimeRecord,
    }));
    await app.register(websocket);
    await app.register(registerNativeCodexRoutes, {
      gateway,
      profileId,
      webSocketCompression: true,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const listening = app.server.address();
    assert.ok(listening && typeof listening !== "string");
    return {
      wss,
      close,
      url: `ws://127.0.0.1:${listening.port}/native-codex/clients/${profileId}/ws`,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

test("explicit profile compression preserves a measured large transfer without loopback deflate", async () => {
  const fixture = await setup();
  const source = Buffer.alloc(6729989, 0x6b);
  let upstreamExtensions: string | undefined;
  fixture.wss.on("connection", (peer) => {
    upstreamExtensions = peer.extensions;
    peer.on("message", (data) => {
      assert.ok(Buffer.isBuffer(data));
      assert.deepEqual(data, source);
      for (let offset = 0; offset < data.length; offset += 256 * 1024)
        peer.send(data.subarray(offset, offset + 256 * 1024));
    });
  });
  const client = new WebSocket(fixture.url);
  client.on("error", () => {});
  let negotiation = "";
  client.on("upgrade", (response) => {
    negotiation = String(response.headers["sec-websocket-extensions"] ?? "");
  });
  try {
    await once(client, "open");
    assert.equal(client.extensions, "permessage-deflate");
    for (const parameter of [
      "server_no_context_takeover",
      "client_no_context_takeover",
      "server_max_window_bits=10",
      "client_max_window_bits=10",
    ])
      assert.ok(negotiation.includes(parameter), parameter);
    const echoed = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      client.on("message", (data, binary) => {
        assert.equal(binary, true);
        assert.ok(Buffer.isBuffer(data));
        total += data.length;
        assert.ok(total <= source.length);
        chunks.push(data);
        if (total === source.length) resolve(Buffer.concat(chunks));
      });
      client.once("close", (code) => reject(Error(`transfer closed: ${code}`)));
    });
    client.send(source, { compress: true });
    assert.deepEqual(await echoed, source);
    assert.equal(upstreamExtensions, "");
  } finally {
    client.terminate();
    await fixture.close();
  }
});

test("compressed client input still rejects decoded bytes over eight MiB", async () => {
  const fixture = await setup();
  let messages = 0;
  fixture.wss.on("connection", (peer) => peer.on("message", () => messages++));
  const client = new WebSocket(fixture.url);
  client.on("error", () => {});
  try {
    await once(client, "open");
    assert.equal(client.extensions, "permessage-deflate");
    const closed = once(client, "close");
    client.send(Buffer.alloc(NATIVE_CODEX_MAX_MESSAGE_BYTES + 1), {
      compress: true,
    });
    const [code] = await closed;
    assert.equal(code, 1009);
    assert.equal(messages, 0);
  } finally {
    client.terminate();
    await fixture.close();
  }
});

test("profile compression retains the independent two MiB upstream limit", async () => {
  const fixture = await setup();
  fixture.wss.on("connection", (peer) =>
    peer.send(Buffer.alloc(NATIVE_CODEX_MAX_UPSTREAM_MESSAGE_BYTES + 1), {
      fin: false,
      binary: true,
    }),
  );
  const client = new WebSocket(fixture.url);
  client.on("error", () => {});
  try {
    await once(client, "open");
    assert.equal(client.extensions, "permessage-deflate");
    const [code] = await once(client, "close");
    assert.equal(code, 1009);
  } finally {
    client.terminate();
    await fixture.close();
  }
});

test("compression requires a fixed profile and a real boolean option", async () => {
  for (const options of [
    { webSocketCompression: true },
    { profileId, webSocketCompression: "true" },
  ]) {
    const app = Fastify();
    try {
      await app.register(websocket);
      app.register(
        registerNativeCodexRoutes,
        options as unknown as Parameters<typeof registerNativeCodexRoutes>[1],
      );
      await assert.rejects(async () => {
        await app.ready();
      }, /compression.*profile|compression.*boolean/i);
    } finally {
      await app.close();
    }
  }
});
