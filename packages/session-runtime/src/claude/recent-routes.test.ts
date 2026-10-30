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
test("CC/ACP readonly recent and detail HTTP routes preserve raw contracts and validate bounded requests", async () => {
  const home = await mkdtemp(join(tmpdir(), "aux-recent-http-")),
    app = Fastify(),
    db = new SessionDatabase(home),
    hub = new EventHub();
  let fullReads = 0;
  const rows = [
    {
      type: "assistant",
      uuid: "reply",
      session_id: "cc-one",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "answer" }],
      },
    },
  ];
  const call = (async (method) => {
    if (method === "listSessions") return [];
    assert.equal(method, "getSessionMessages");
    fullReads++;
    return rows;
  }) as typeof historyCall;
  const history = new ClaudeHistory(home, { HOME: home }, { call });
  registerClaudeRoutes(app, { history,historySessionId:async(id:string)=>id } as ClaudeService);
  const service = createAcpService({
    hub,
    dataHome: home,
    env: { HOME: home },
    history: db,
  });
  let nativeConnections = 0;
  service.connect = async () => {
    nativeConnections++;
    throw new Error("Readonly history must not connect an Agent");
  };
  registerAcpRoutes(app, service);
  db.upsertSession({ sessionId: "acp-one", agentId: "fixture", cwd: home });
  db.appendUpdate("acp-one", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "stable" },
  });
  try {
    let result = await app.inject({
      method: "POST",
      url: "/api/cc/session-messages?view=recent",
      payload: { session_id: "cc-one", metadataOnly: true },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(fullReads, 0);
    result = await app.inject({
      method: "POST",
      url: "/api/cc/session-messages?view=recent",
      payload: { session_id: "cc-one", limit: 80 },
    });
    assert.equal(result.json().projection, "cc-messages");
    assert.equal(result.json().data[0].uuid, "reply");
    assert.deepEqual(
      (
        await app.inject({
          method: "POST",
          url: "/api/cc/session-messages",
          payload: { session_id: "cc-one" },
        })
      ).json(),
      rows,
    );
    result = await app.inject({
      method: "POST",
      url: "/api/acp/session?view=recent",
      payload: { session_id: "acp-one" },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().projection, "acp-entries");
    assert.equal(result.json().data[0].text, "stable");
    const stableId = result.json().data[0].id;
    result = await app.inject({
      method: "POST",
      url: "/api/acp/session?view=recent",
      payload: { session_id: "acp-one" },
    });
    assert.equal(result.json().data[0].id, stableId);
    const raw = await app.inject({
      method: "POST",
      url: "/api/acp/session",
      payload: { session_id: "acp-one" },
    });
    assert.equal(raw.json()[0].sessionUpdate, "agent_message_chunk");
    const detail = await app.inject({
      method: "POST",
      url: "/api/cc/session-message-detail",
      payload: { session_id: "cc-one", item_id: "reply", limit: 65536 },
    });
    assert.equal(detail.statusCode, 200);
    assert.match(detail.json().text, /answer/);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/acp/session?view=recent",
          payload: { session_id: "acp-one", limit: 999 },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/cc/session-message-detail",
          payload: { session_id: "cc-one", item_id: "reply", offset: -1 },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/acp/session?view=unknown",
          payload: { session_id: "acp-one" },
        })
      ).statusCode,
      400,
    );
    assert.equal(nativeConnections, 0);
  } finally {
    await app.close();
    await service.close();
    hub.close();
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});
