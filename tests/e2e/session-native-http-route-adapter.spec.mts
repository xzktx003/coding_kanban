import { test, expect } from "@playwright/test";
import { createServer, request } from "node:http";
import { runInNewContext } from "node:vm";
import { createNativeHttpRouteAdapter } from "./helpers/native-http-route-adapter.mts";

async function fixture() {
  let origin = "";
  const adapter = createNativeHttpRouteAdapter({ origin: () => origin });
  const server = createServer(async (req, res) => {
    if (!(await adapter.handleHttp(req, res))) {
      res.writeHead(200, {
        "content-type": "text/plain",
        etag: '"static-kept"',
      });
      res.end("original static middleware");
    }
  });
  await new Promise<void>((done) => server.listen(0, "0.0.0.0", done));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  return {
    adapter,
    origin,
    read(path: string, body?: string) {
      return new Promise<{ status: number; headers: any; body: string }>(
        (done, reject) => {
          const req = request(
            new URL(path, origin),
            { method: body === undefined ? "GET" : "POST" },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (data) => chunks.push(Buffer.from(data)));
              res.once("end", () =>
                done({
                  status: res.statusCode!,
                  headers: res.headers,
                  body: Buffer.concat(chunks).toString("utf8"),
                }),
              );
            },
          );
          req.once("error", reject);
          req.end(body);
        },
      );
    },
    async close() {
      await adapter.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

test("native HTTP delegate preserves stock reverse route priority and static middleware", async () => {
  const f = await fixture();
  try {
    await f.adapter.page.route("**/api/**", async (route) =>
      route.fulfill({ json: { generic: true } }),
    );
    await f.adapter.page.route(/\/api\/special(?:\?.*)?$/g, async (route) => {
      const request = route.request();
      await route.fulfill({
        status: 201,
        json: {
          method: request.method(),
          body: request.postDataJSON(),
          pathname: new URL(request.url()).pathname,
        },
      });
    });
    for (let i = 0; i < 2; i++) {
      const value = await f.read(
        "/api/special?version=" + i,
        '{"text":"native input"}',
      );
      expect(value.status).toBe(201);
      expect(JSON.parse(value.body)).toEqual({
        method: "POST",
        body: { text: "native input" },
        pathname: "/api/special",
      });
    }
    const original = await f.read("/src/App.tsx");
    expect(original.body).toBe("original static middleware");
    expect(original.headers.etag).toBe('"static-kept"');
    expect(f.adapter.traffic.requests).toBe(2);
    expect(f.adapter.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("unknown or oversized API input fails closed without a fallback", async () => {
  const f = await fixture();
  try {
    expect((await f.read("/api/unknown")).status).toBe(500);
    let handled = false;
    await f.adapter.page.route("**/api/oversized", async (route) => {
      handled = true;
      await route.fulfill({ json: { accepted: true } });
    });
    expect(
      (await f.read("/api/oversized", "x".repeat(2 * 1024 * 1024 + 1))).status,
    ).toBe(500);
    expect(handled).toBe(false);
    expect(f.adapter.errors).toHaveLength(2);
    expect(f.adapter.traffic.responseBodyBytes).toBe(0);
  } finally {
    await f.close();
  }
});

test("HTML init serialization preserves arguments and never invokes real WebSocket interception", async () => {
  const f = await fixture();
  let closed = 0,
    intercepted = false;
  try {
    const text = "</script><p>fixture only</p>";
    await f.adapter.page.addInitScript(
      ({ text }: any) => {
        const add = (a: number, b: number) => a + b;
        (globalThis as any).value = { text, sum: add(1, 2) };
      },
      { text },
    );
    const context: any = {};
    runInNewContext(f.adapter.initScript(), context);
    expect(JSON.parse(JSON.stringify(context.value))).toEqual({ text, sum: 3 });
    expect(f.adapter.initScript()).not.toContain("</script>");
    await f.adapter.page.routeWebSocket(/.*/, () => {
      intercepted = true;
    });
    expect(intercepted).toBe(false);
    expect(f.adapter.webSocketIntents).toEqual(["/.*/"]);
    f.adapter.page.once("close", () => {
      closed++;
    });
    await f.adapter.close();
    await f.adapter.close();
    expect(closed).toBe(1);
  } finally {
    await f.close();
  }
});
