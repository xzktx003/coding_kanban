import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionPreviewRoutes } from "./session-preview.js";
test("preview rejects non-local targets and low service ports", async () => {
  const app = Fastify();
  registerSessionPreviewRoutes(app);
  try {
    for (const url of [
      "http://169.254.169.254",
      "http://example.com:3000",
      "file:///etc/passwd",
      "http://127.0.0.1:22",
      "http://user:pass@localhost:3000",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/session-previews",
        payload: { url },
      });
      assert.equal(response.statusCode, 400, url);
    }
  } finally {
    await app.close();
  }
});
test("preview maps HTML and module assets through the same LAN origin", async () => {
  const requests: string[] = [];
  const app = Fastify();
  registerSessionPreviewRoutes(app, {
    fetch: async (url) => {
      requests.push(String(url));
      return new Response('<script type="module" src="/src/app.js"></script>', {
        headers: { "content-type": "text/html" },
      });
    },
  });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/session-previews",
      payload: { url: "http://localhost:3000/app" },
    });
    assert.equal(created.statusCode, 200);
    const path = created.json().path;
    const response = await app.inject(path);
    assert.equal(response.statusCode, 200);
    assert.match(
      response.body,
      /\/api\/session-previews\/[a-z0-9-]+\/src\/app.js/,
    );
    assert.equal(requests[0], "http://127.0.0.1:3000/app");
  } finally {
    await app.close();
  }
});
