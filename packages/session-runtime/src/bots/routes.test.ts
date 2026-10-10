import { test } from "node:test";
import assert from "node:assert/strict";
import fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionDatabase } from "../storage/database.js";
import { DelegationTokens, registerBotRoutes } from "./routes.js";
test("bot MCP denies unauthenticated and unlisted targets, delegates one hop only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bots-"));
  const db = new SessionDatabase(dir);
  const app = fastify();
  const tokens = new DelegationTokens();
  const called: unknown[][] = [];
  registerBotRoutes(app, {
    db,
    tokens,
    runBotUnattended: async (...args) => {
      called.push(args);
      return { sessionId: "s", reply: "answer", blocked: false };
    },
  });
  try {
    for (const id of ["a", "b", "c"])
      db.createBot({ id, name: id, avatar: "", color: "", cwd: "/tmp" });
    db.updateBot("a", { allowedBotIds: ["b", "a"] });
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ask_bot", arguments: { bot: "b", message: "hello" } },
    };
    assert.equal(
      (await app.inject({ method: "POST", url: "/mcp/bots?from=a", payload }))
        .statusCode,
      401,
    );
    const token = tokens.issue("a");
    const headers = { "x-codexia-delegation": token };
    const success = await app.inject({
      method: "POST",
      url: "/mcp/bots?from=a",
      headers,
      payload,
    });
    assert.equal(success.json().result.isError, false);
    assert.equal(called[0]?.[3], false);
    payload.params.arguments.bot = "c";
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/mcp/bots?from=a",
          headers,
          payload,
        })
      ).json().result.isError,
      true,
    );
    tokens.revoke(token);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/mcp/bots?from=a",
          headers,
          payload,
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("only successful bot creation records anonymous usage and telemetry failure is harmless", async () => {
  const root = await mkdtemp(join(tmpdir(), "bot-track-"));
  const db = new SessionDatabase(root),
    app = fastify(),
    tokens = new DelegationTokens();
  const events: string[] = [];
  registerBotRoutes(app, {
    db,
    tokens,
    runBotUnattended: async () => ({
      sessionId: "s",
      reply: "",
      blocked: false,
    }),
    track: async (event) => {
      events.push(event);
      throw new Error("offline");
    },
  });
  try {
    const request = {
      method: "POST" as const,
      url: "/api/bots/create",
      payload: {
        id: "bot",
        name: "private name",
        avatar: "",
        color: "",
        cwd: root,
      },
    };
    assert.equal((await app.inject(request)).statusCode, 200);
    assert.equal((await app.inject(request)).statusCode, 500);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(events, ["bot_created"]);
  } finally {
    await app.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
