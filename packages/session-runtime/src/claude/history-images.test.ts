import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerClaudeRoutes } from "./routes.js";
import { ClaudeHistory, type historyCall } from "./history.js";
import type { ClaudeService } from "./service.js";
import { createAcpService, registerAcpRoutes } from "../acp/index.js";
import { EventHub } from "../core/events.js";
import { SessionDatabase } from "../storage/database.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64",
);
test("CC/ACP large history images have metadata-only previews and exact readonly binary image/download HTTP readers", async () => {
  const home = await mkdtemp(join(tmpdir(), "aux-images-http-")),
    app = Fastify(),
    db = new SessionDatabase(home),
    hub = new EventHub();
  const largePng = Buffer.concat([png, Buffer.alloc(180_000)]);
  const image = {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: largePng.toString("base64"),
    },
  };
  const row = {
    type: "user",
    uuid: "image-message",
    session_id: "cc-one",
    message: {
      role: "user",
      content: [{ type: "text", text: "caption" }, image],
    },
  };
  const call = (async (method, args) =>
    method === "listSessions"
      ? []
      : args[0] === "cc-one"
        ? [row]
        : []) as typeof historyCall;
  const history = new ClaudeHistory(home, { HOME: home }, { call });
  registerClaudeRoutes(app, { history,historySessionId:async(id:string)=>id } as ClaudeService);
  const service = createAcpService({
    hub,
    dataHome: home,
    env: { HOME: home },
    history: db,
  });
  service.connect = async () => {
    throw new Error("Image reads cannot connect an Agent");
  };
  registerAcpRoutes(app, service);
  db.upsertSession({ sessionId: "acp-one", agentId: "fixture", cwd: home });
  const source = db.appendUpdate("acp-one", {
    sessionUpdate: "user_message_chunk",
    content: {
      type: "image",
      mimeType: "image/png",
      data: largePng.toString("base64"),
    },
  });
  try {
    const cc = await history.recentMessages("cc-one"),
      acp = await db.getRecentUpdates("acp-one");
    assert.deepEqual(cc.data[0].historyImages, [
      { index: 0, mimeType: "image/png" },
    ]);
    assert.deepEqual(acp.data[0].historyImages, [
      { index: 0, mimeType: "image/png" },
    ]);
    assert.equal(JSON.stringify(cc).includes(image.source.data), false);
    assert.equal(JSON.stringify(acp).includes(image.source.data), false);
    for (const [url, session, item] of [
      ["/api/cc/session-message-image", "cc-one", "image-message"],
      ["/api/acp/session-image", "acp-one", `source-${source}`],
    ]) {
      const payload = { session_id: session, item_id: item, image_index: 0 };
      const response = await app.inject({ method: "POST", url, payload });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"], "image/png");
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.equal(response.headers["x-history-image-width"], "1");
      assert.match(
        String(response.headers["x-history-image-revision"]),
        /^[a-f0-9]{64}$/,
      );
      assert.deepEqual(response.rawPayload, largePng);
      const download = await app.inject({
        method: "POST",
        url,
        payload: { ...payload, download: true },
      });
      assert.match(
        String(download.headers["content-disposition"]),
        /^attachment/,
      );
      assert.deepEqual(download.rawPayload, largePng);
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url,
            payload: { ...payload, session_id: "different" },
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url,
            payload: { ...payload, image_index: 1 },
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url,
            payload: { ...payload, image_index: -1 },
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url,
            payload: { ...payload, item_id: "../../private" },
          })
        ).statusCode,
        404,
      );
    }
    const large = Buffer.from(png);
    large.writeUInt32BE(10000, 16);
    large.writeUInt32BE(5000, 20);
    const largeSource = db.appendUpdate("acp-one", {
      sessionUpdate: "user_message_chunk",
      content: {
        type: "image",
        mimeType: "image/png",
        data: large.toString("base64"),
      },
    });
    const payload = {
      session_id: "acp-one",
      item_id: `source-${largeSource}`,
      image_index: 0,
    };
    const preview = await app.inject({
      method: "POST",
      url: "/api/acp/session-image",
      payload,
    });
    assert.equal(preview.statusCode, 413);
    assert.equal(preview.json().code, "HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT");
    const download = await app.inject({
      method: "POST",
      url: "/api/acp/session-image",
      payload: { ...payload, download: true },
    });
    assert.equal(download.statusCode, 200);
    assert.deepEqual(download.rawPayload, large);
  } finally {
    await app.close();
    await service.close();
    hub.close();
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});
