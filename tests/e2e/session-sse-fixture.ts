import { type Page } from "@playwright/test";
import { createServer as httpServer, type ServerResponse } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export async function liveStream(page: Page, baseURL: string) {
  const clients = new Set<ServerResponse>();
  let opens = 0;
  const handler = (req: any, res: ServerResponse) => {
    if (req.url?.startsWith("/events")) {
      opens++;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.flushHeaders();
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else {
      res.writeHead(404);
      res.end();
    }
  };
  const secure = new URL(baseURL).protocol === "https:";
  const tlsDir = mkdtempSync(join(tmpdir(), "session-sse-"));
  if (secure)
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
        "/CN=isolated-test",
        "-keyout",
        join(tlsDir, "key.pem"),
        "-out",
        join(tlsDir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
  const server = secure
    ? httpsServer(
        {
          cert: readFileSync(join(tlsDir, "cert.pem")),
          key: readFileSync(join(tlsDir, "key.pem")),
        },
        handler,
      )
    : httpServer(handler);
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
  const port = (server.address() as any).port;
  const origin = new URL(baseURL);
  origin.port = String(port);
  await page.addInitScript(
    ({ origin }) => {
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url: string | URL, options?: EventSourceInit) {
          const parsed = new URL(String(url), location.href);
          super(
            parsed.pathname.endsWith("/api/events")
              ? `${origin}/events${parsed.search}`
              : url,
            options,
          );
        }
      };
    },
    { origin: origin.origin },
  );
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": alive\n\n");
  }, 250);
  return {
    opens: () => opens,
    connections: () => clients.size,
    disconnect: () => {
      for (const c of clients) c.end();
    },
    raw: (data: string) => {
      for (const c of clients) c.write(`data: ${data}\n\n`);
    },
    envelope: (seq: number, event: string, payload: unknown) => {
      for (const c of clients)
        c.write(`data: ${JSON.stringify({ seq, event, payload })}\n\n`);
    },
    emit: (seq: number, payload: any) => {
      for (const c of clients)
        c.write(
          `data: ${JSON.stringify({ seq, event: "codex:notification", payload })}\n\n`,
        );
    },
    close: async () => {
      clearInterval(heartbeat);
      for (const c of clients) c.end();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(tlsDir, { recursive: true, force: true });
    },
  };
}
