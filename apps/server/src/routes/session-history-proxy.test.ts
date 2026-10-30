import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { connect, constants } from "node:http2";
import type { ProxyOptions } from "../../../web/node_modules/vite/dist/node/index.js";
const { createServer: createViteServer } = await import(
  new URL("../../../web/node_modules/vite/dist/node/index.js", import.meta.url)
    .href
);
const { resolveWebDevProxies } = await import(
  new URL("../../../web/src/lib/dev-server-config.ts", import.meta.url).href
);

for (const [tls, pathname, expected] of [
  [false, "/api/session/api/codex/thread/turns/list?view=chat", true],
  [true, "/api/session/api/codex/thread/turns/list?view=chat", true],
  [false, "/api/session/api/cc/session-messages?view=recent", true],
  [true, "/api/session/api/cc/session-messages?view=recent", true],
  [false, "/api/session/api/acp/session?view=recent", true],
  [true, "/api/session/api/acp/session?view=recent", true],
  [true, "/api/session/api/cc/session-message-detail", true],
  [true, "/api/session/api/cc/session-message-image", true],
  [true, "/api/session/api/acp/session-detail", true],
  [true, "/api/session/api/acp/session-image", true],
  [true, "/api/session/api/cc/session-message-detail?source=ignored", false],
  [true, "/api/session/api/acp/session-image?download=1", false],
  [true, "/api/session/api/cc/session-messages?view=full", false],
  [true, "/api/session/api/acp/session?view=recent&view=full", false],
  [true, "/api/session/api/cc/send-message", false],
  [true, "/api/session/api/acp/prompt", false],
  [true, "/api/session/api/codex/turn/start", false],
] as const)
  test(
    `${tls ? "HTTP/2 HTTPS" : "HTTP/1 HTTP"} ${pathname}: ${expected ? "read cancellation reaches upstream" : "unlisted request keeps its existing cancellation semantics"}`,
    { timeout: 15000 },
    async (t) => {
      let received!: () => void, closed!: () => void;
      const requestReceived = new Promise<void>((resolve) => {
        received = resolve;
      });
      const upstreamClosed = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const upstream = createServer((request, response) => {
        request.resume();
        request.on("end", received);
        response.on("close", closed);
      });
      upstream.listen(0, "127.0.0.1");
      await once(upstream, "listening");
      const target = `http://127.0.0.1:${(upstream.address() as any).port}`;
      const dir = mkdtempSync(join(tmpdir(), "history-proxy-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      let https;
      if (tls) {
        execFileSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            join(dir, "key.pem"),
            "-out",
            join(dir, "cert.pem"),
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
          ],
          { stdio: "ignore" },
        );
        https = {
          key: readFileSync(join(dir, "key.pem")),
          cert: readFileSync(join(dir, "cert.pem")),
        };
      }
      const proxies = resolveWebDevProxies({
        apiTarget: target,
        wsTarget: target.replace("http:", "ws:"),
      });
      const transport: unknown[] = [],
        configure = proxies["/api"].configure;
      proxies["/api"].configure = (
        proxy: Parameters<NonNullable<ProxyOptions["configure"]>>[0],
        options: Parameters<NonNullable<ProxyOptions["configure"]>>[1],
      ) => {
        proxy.on("proxyReq", (outgoing, request, response) => {
          transport.push({
            event: "proxyReq",
            path: request.url,
            method: request.method,
            outgoing: outgoing.path,
          });
          request.once("aborted", () =>
            transport.push({
              event: "requestAborted",
              finished: response.writableFinished,
            }),
          );
          response.once("finish", () =>
            transport.push({
              event: "responseFinish",
              finished: response.writableFinished,
            }),
          );
          response.once("close", () =>
            transport.push({
              event: "responseClose",
              finished: response.writableFinished,
            }),
          );
          outgoing.once("close", () =>
            transport.push({ event: "outgoingClose" }),
          );
        });
        configure(proxy, options);
      };
      const vite = await createViteServer({
        configFile: false,
        envFile: false,
        logLevel: "silent",
        appType: "custom",
        server: {
          host: "0.0.0.0",
          port: 0,
          watch: null,
          https,
          proxy: proxies,
        },
      });
      t.after(async () => {
        upstream.closeAllConnections();
        await vite.close();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      });
      await vite.listen();
      const lan = Object.values(networkInterfaces())
        .flat()
        .find(
          (address) => address?.family === "IPv4" && !address.internal,
        )?.address;
      assert.ok(lan);
      const port = vite.httpServer.address().port;
      if (tls) {
        const client = connect(`https://${lan}:${port}`, {
          rejectUnauthorized: false,
        });
        t.after(() => client.destroy());
        const stream = client.request({
          ":path": pathname,
          ":method": "POST",
          "content-type": "application/json",
        });
        stream.on("error", () => {});
        stream.end(JSON.stringify({ threadId: "fixture", limit: 10 }));
        await requestReceived;
        stream.close(constants.NGHTTP2_CANCEL);
      } else {
        const controller = new AbortController();
        const pending = fetch(`http://${lan}:${port}${pathname}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ threadId: "fixture", limit: 10 }),
          signal: controller.signal,
        }).catch(() => null);
        await requestReceived;
        controller.abort();
        await pending;
      }
      let timer: ReturnType<typeof setTimeout>;
      const aborted = await Promise.race([
        upstreamClosed.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      clearTimeout(timer!);
      assert.equal(
        aborted,
        expected,
        "completed POST survives browser cancellation and holds the history reader: " +
          JSON.stringify(transport),
      );
    },
  );
