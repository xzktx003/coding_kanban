import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSessionFollowupRoutes } from "./session-followups.js";
import { validAgentMention } from "@agent-orchestrator/shared";
test("captured plugin identity survives queueing and reaches native typed input without loosening subagent identity", async () => {
  const app = Fastify(),
    calls: Array<{ method: string; params: any }> = [];
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    autoStart: false,
    runtime: {
      statuses: async () => ({ root: "idle" }),
      call: async (method, params) => {
        calls.push({ method, params });
        return { turn: { id: "plugin-turn" } };
      },
    },
  });
  const mention = {
    name: "Fixture Name",
    path: "plugin://fixture-native@market",
  };
  const payload = {
    id: "plugin-message",
    threadId: "root",
    text: "@Fixture Name analyze",
    images: [],
    mode: "queue",
    parameters: { cwd: "/captured" },
    mentions: [mention],
  };
  try {
    assert.equal(validAgentMention(mention), false);
    for (const path of [
      "plugin://",
      "plugin://../escape",
      "plugin://id?secret=value",
      "plugin://id#fragment",
      "plugin://id\n",
      "file:///private",
      "plugin://" + "a".repeat(513),
    ]) {
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/session/followups/submit",
            payload: { ...payload, mentions: [{ name: "invalid", path }] },
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(calls.length, 0);
    const response = await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    payload.mentions[0].path = "plugin://changed-after-submit";
    payload.parameters.cwd = "/other";
    await queue.tick();
    await queue.tick();
    assert.equal(
      calls.filter((call) => call.method === "turn/start").length,
      1,
    );
    assert.deepEqual(
      calls.find((call) => call.method === "turn/start")?.params.input,
      [
        {
          type: "mention",
          name: "Fixture Name",
          path: "plugin://fixture-native@market",
        },
        { type: "text", text: "@Fixture Name analyze", text_elements: [] },
      ],
    );
    assert.equal(calls[0].params.cwd, "/captured");
  } finally {
    await app.close();
  }
});
