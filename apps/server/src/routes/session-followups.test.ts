import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSessionFollowupRoutes } from "./session-followups.js";
const body = {
  id: "request",
  threadId: "thread",
  text: "hello",
  images: [],
  parameters: { model: "saved" },
  mode: "queue",
};
test("validates input before journaling, deduplicates requests and serializes revision conflicts", async () => {
  const app = Fastify();
  const calls: any[] = [];
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    autoStart: false,
    runtime: {
      statuses: async () => ({ thread: "idle" }),
      call: async (method, params) => {
        calls.push({ method, params });
        return { turn: { id: "run" } };
      },
    },
  });
  try {
    for (const bad of [
      { ...body, threadId: "__proto__" },
      { ...body, images: ["/tmp/x\0"] },
      { ...body, parameters: { threadId: "other" } },
      { ...body, mode: "exec" },
      { ...body, text: "", images: [] },
      { ...body, contexts:[{id:"ref",kind:"exec",name:"x",text:"x"}] },
      { ...body, contexts:[{id:"ref",kind:"file",name:"x",text:"x",path:"/tmp/x\0"}] },
      { ...body, contexts:[{id:"ref",kind:"file",name:"x",text:"x",range:{start:8,end:1}}] },
      { ...body, contexts:[{id:"ref",kind:"paste",name:"x",text:"x".repeat(200_000)}] },
    ]) {
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/session/followups/submit",
            payload: bad,
          })
        ).statusCode,
        400,
      );
    }
    const a = await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: body,
    });
    assert.equal(a.statusCode, 200);
    const b = await app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: body,
    });
    assert.equal(b.json().items.length, 1);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/followups/change",
          payload: {
            threadId: "thread",
            revision: 0,
            action: { type: "clear" },
          },
        })
      ).statusCode,
      409,
    );
    await queue.tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.model, "saved");
    assert.equal(
      (
        await app.inject({ url: "/api/session/followups?threadId=thread" })
      ).json().items[0].status,
      "sent",
    );
  } finally {
    await app.close();
  }
});
