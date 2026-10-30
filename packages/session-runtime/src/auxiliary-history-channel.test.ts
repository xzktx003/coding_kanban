import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { registerLocalAuxiliaryHistoryChannel } from "./auxiliary-history-channel.js";

test("fixed local channels preserve raw compatibility, bounded recent/detail/image and reject HTTP source configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "aux-channel-")),
    dataHome = join(root, "runtime"),
    nativeHome = join(root, "native"),
    cacheHome = join(root, "private-cache");
  await mkdir(join(dataHome, ".codexia"), { recursive: true });
  await mkdir(join(nativeHome, ".claude/projects"), { recursive: true });
  const path = join(dataHome, ".codexia/cache.db"),
    db = new Database(path);
  db.exec(
    "CREATE TABLE acp_sessions(session_id TEXT);CREATE TABLE acp_session_updates(id INTEGER PRIMARY KEY,session_id TEXT,payload TEXT,created_at TEXT)",
  );
  db.prepare("INSERT INTO acp_sessions VALUES('session')").run();
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
    "base64",
  );
  const insert = db.prepare(
    "INSERT INTO acp_session_updates VALUES(?,?,?,'now')",
  );
  insert.run(
    1,
    "session",
    JSON.stringify({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "question" },
    }),
  );
  insert.run(
    2,
    "session",
    JSON.stringify({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "answer" },
    }),
  );
  insert.run(
    3,
    "session",
    JSON.stringify({
      sessionUpdate: "user_message_chunk",
      content: {
        type: "image",
        mimeType: "image/png",
        data: image.toString("base64"),
      },
    }),
  );
  db.close();
  const before = await readFile(path),
    app = Fastify();
  let fallbacks = 0,
    checks = 0;
  registerLocalAuxiliaryHistoryChannel(app, {
    dataHome,
    cacheHome,
    sourceScope: "fixture",
    nativeEnv: { HOME: nativeHome, PATH: process.env.PATH },
    verifySource: () => {
      checks++;
    },
    fallback: (_request, reply) => {
      fallbacks++;
      return reply.send({ legacy: true });
    },
  });
  try {
    const raw = await app.inject({
      method: "POST",
      url: "/api/session/api/acp/session",
      payload: { session_id: "session" },
    });
    assert.deepEqual(raw.json(), { legacy: true });
    assert.equal(fallbacks, 1);
    assert.equal(checks, 0);
    const recent = await app.inject({
      method: "POST",
      url: "/api/session/api/acp/session?view=recent",
      payload: { session_id: "session", limit: 1 },
    });
    assert.equal(recent.statusCode, 200);
    assert.equal(recent.json().projection, "acp-entries");
    assert.ok(recent.json().nextCursor);
    assert.equal(recent.headers["cache-control"], "no-store");
    const meta = await app.inject({
      method: "POST",
      url: "/api/session/api/acp/session?view=recent",
      payload: { session_id: "session", metadataOnly: true },
    });
    assert.deepEqual(meta.json().data, []);
    const detail = await app.inject({
      method: "POST",
      url: "/api/session/api/acp/session-detail",
      payload: {
        session_id: "session",
        item_id: "source-1",
        offset: 0,
        limit: 1024,
      },
    });
    assert.equal(detail.statusCode, 200);
    assert.ok(detail.json().text.includes("question"));
    const binary = await app.inject({
      method: "POST",
      url: "/api/session/api/acp/session-image",
      payload: { session_id: "session", item_id: "source-3", image_index: 0 },
    });
    assert.equal(binary.statusCode, 200, binary.body);
    assert.deepEqual(binary.rawPayload, image);
    assert.equal(binary.headers["content-type"], "image/png");
    for (const url of [
      "/api/session/api/acp/session?view=recent",
      "/api/session/api/cc/session-messages?view=recent",
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        payload: {
          session_id: "session",
          dir: "/untrusted",
          HOME: "/untrusted",
        },
      });
      assert.equal(response.statusCode, 400);
      assert.match(response.json().error, /目录|配置/);
    }
    assert.deepEqual(await readFile(path), before);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
