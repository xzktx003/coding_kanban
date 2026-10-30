import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Node fixture delegate only. This is never a Playwright Page or production API. */
export function createNativeHttpRouteAdapter(options: {
  origin: () => string;
  maximumRequestBytes?: number;
}) {
  const routes: Array<{ matches: RegExp; handler: (route: any) => unknown }> =
    [];
  const inits: string[] = [];
  const closeCallbacks: Array<() => unknown> = [];
  const requests: Record<string, number> = {};
  const errors: string[] = [];
  const traffic = { requests: 0, responseBodyBytes: 0, requestBodyBytes: 0 };
  const webSocketIntents: string[] = [];
  let closed = false;
  const maximumRequestBytes = options.maximumRequestBytes ?? 2 * 1024 * 1024;
  assert.ok(
    Number.isSafeInteger(maximumRequestBytes) &&
      maximumRequestBytes > 0 &&
      maximumRequestBytes <= 2 * 1024 * 1024,
  );

  const pattern = (value: string | RegExp) => {
    if (value instanceof RegExp) return value;
    assert.equal(typeof value, "string");
    return new RegExp(
      "^" +
        value
          .split("**")
          .map((piece) =>
            piece
              .split("*")
              .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
              .join("[^/]*"),
          )
          .join(".*") +
        "$",
    );
  };
  const page = {
    async route(value: string | RegExp, handler: (route: any) => unknown) {
      assert.equal(closed, false);
      routes.push({ matches: pattern(value), handler });
    },
    async addInitScript(fn: Function, arg?: unknown) {
      assert.equal(closed, false);
      assert.equal(typeof fn, "function");
      // TSX preserves function names using __name in serialized nested code.
      inits.push(
        `(()=>{const __name=(fn,name)=>fn;return (${fn.toString()})(${arg === undefined ? "undefined" : JSON.stringify(arg)});})();`,
      );
    },
    once(event: string, callback: () => unknown) {
      assert.equal(event, "close");
      assert.equal(closed, false);
      closeCallbacks.push(callback);
    },
    async routeWebSocket(value: string | RegExp, _handler: unknown) {
      // Record stock fixture intent, without installing Fetch/WS interception.
      // The owned Vite launcher retains real HMR and rejects API upgrades itself.
      webSocketIntents.push(String(value));
    },
  };
  async function handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const origin = new URL(options.origin());
    assert.ok(
      ["https:", "http:"].includes(origin.protocol) &&
        !origin.username &&
        !origin.password &&
        origin.pathname === "/" &&
        !origin.search &&
        !origin.hash,
    );
    const url = new URL(req.url ?? "/", origin);
    if (!url.pathname.startsWith("/api/")) return false;
    traffic.requests++;
    const method = req.method ?? "GET";
    const key = method + " " + url.pathname;
    requests[key] = (requests[key] ?? 0) + 1;
    try {
      assert.equal(closed, false, "Fixture was closed");
      assert.equal(
        url.origin,
        origin.origin,
        "Absolute-form request changed fixture origin",
      );
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maximumRequestBytes)
          throw new Error("Fixture request exceeds 2 MiB budget");
        chunks.push(Buffer.from(chunk));
      }
      traffic.requestBodyBytes += size;
      const body = Buffer.concat(chunks).toString("utf8");
      for (const { matches, handler } of [...routes].reverse()) {
        matches.lastIndex = 0;
        if (!matches.test(url.href)) continue;
        let fulfilled = false;
        await handler({
          request: () => ({
            url: () => url.href,
            method: () => method,
            postDataJSON: () => (body ? JSON.parse(body) : null),
          }),
          fulfill: async (value: any) => {
            assert.equal(
              fulfilled,
              false,
              "Fixture fulfilled the same request twice",
            );
            fulfilled = true;
            const payload =
              value.json === undefined
                ? (value.body ?? "")
                : JSON.stringify(value.json);
            const bytes = Buffer.isBuffer(payload)
              ? payload
              : Buffer.from(payload);
            traffic.responseBodyBytes += bytes.length;
            res.writeHead(value.status ?? 200, {
              "content-type":
                value.contentType ??
                (value.json === undefined ? "text/plain" : "application/json"),
              "cache-control": "no-store",
              ...value.headers,
            });
            res.end(bytes);
          },
        });
        assert.equal(
          fulfilled,
          true,
          "Matched stock route did not fulfill request",
        );
        return true;
      }
      throw new Error(
        "Unmatched API request; never forward fixture APIs to a formal service",
      );
    } catch (error) {
      errors.push(String(error).slice(0, 1_000));
      if (!res.headersSent)
        res.writeHead(500, {
          "content-type": "text/plain",
          "cache-control": "no-store",
        });
      res.end("Isolated fixture request failed");
      return true;
    }
  }
  return {
    page,
    handleHttp,
    initScript: () => inits.join("\n").replace(/<\/script/gi, "<\\/script"),
    traffic,
    requests,
    errors,
    webSocketIntents,
    async close() {
      if (closed) return;
      closed = true;
      for (const callback of closeCallbacks) await callback();
      routes.length = 0;
      inits.length = 0;
    },
  };
}
