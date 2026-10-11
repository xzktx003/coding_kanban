import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCodexWebsitePreviewRoutes } from "./codex-website-preview.js";
import { WebsitePreviewService } from "../services/codex-website-preview.js";
test("capability discovery is readonly, inputs cannot override headers, DNS, host, or fetch options", async (t) => {
  const app = Fastify();
  let calls = 0;
  registerCodexWebsitePreviewRoutes(
    app,
    new WebsitePreviewService({
      lookup: async () => {
        calls++;
        return [];
      },
    }),
  );
  t.after(() => app.close());
  assert.deepEqual(
    (
      await app.inject("/api/session/api/codex/website-preview/capabilities")
    ).json(),
    { supported: true },
  );
  for (const payload of [
    { url: "https://example.com", headers: { Authorization: "secret" } },
    { url: "https://example.com", address: "127.0.0.1" },
    { url: 7 },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/api/codex/website-preview",
          payload,
        })
      ).statusCode,
      400,
    );
  assert.equal(calls, 0);
  const response = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/website-preview",
    payload: { url: "https://127.0.0.1" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "unavailable" });
  assert.equal(calls, 0);
});
