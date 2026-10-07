import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerSessionTabsRoutes } from "./session-tabs.js";

const a = { kind: "codex", id: "a", cwd: "/a" };
const b = { kind: "cc", id: "b", cwd: "/b" };
test("two devices merge operations, retry idempotently, retain order after restart and never accept layout state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "followed-tabs-"));
  const file = join(dir, "tabs.json");
  let app = Fastify();
  registerSessionTabsRoutes(app, { file });
  const send = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/session/tabs", payload });
  try {
    assert.equal(
      (await app.inject("/api/session/tabs")).json().initialized,
      false,
    );
    await send({ clientId: "desktop", seed: [a], operations: [] });
    // A later device must not seed stale cached tabs over the authoritative set.
    await send({ clientId: "phone", seed: [b], operations: [] });
    assert.deepEqual((await app.inject("/api/session/tabs")).json().cards, [a]);
    const add = {
      clientId: "phone",
      operations: [{ seq: 1, action: { type: "add", card: b } }],
    };
    assert.equal((await send(add)).statusCode, 200);
    await Promise.all([
      send({
        clientId: "desktop",
        operations: [{ seq: 1, action: { type: "remove", key: "codex:a" } }],
      }),
      send(add),
    ]);
    assert.deepEqual((await app.inject("/api/session/tabs")).json().cards, [b]);
    await send({
      clientId: "desktop",
      operations: [
        { seq: 2, action: { type: "add", card: a } },
        { seq: 3, action: { type: "move", key: "codex:a", beforeKey: "cc:b" } },
      ],
    });
    assert.deepEqual((await app.inject("/api/session/tabs")).json().cards, [
      a,
      b,
    ]);
    assert.equal(
      (
        await send({
          clientId: "phone",
          operations: [],
          currentAgentCardId: "b",
          cardsViewMode: "grid",
        })
      ).statusCode,
      400,
    );
    await app.close();
    app = Fastify();
    registerSessionTabsRoutes(app, { file });
    assert.deepEqual((await app.inject("/api/session/tabs")).json().cards, [
      a,
      b,
    ]);
    await send(add); // old retry remains harmless across restart
    assert.deepEqual((await app.inject("/api/session/tabs")).json().cards, [
      a,
      b,
    ]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid batches are atomic and sequence gaps are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "followed-tabs-"));
  const app = Fastify();
  registerSessionTabsRoutes(app, { file: join(dir, "tabs.json") });
  try {
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/session/tabs", payload });
    assert.equal(
      (
        await post({
          clientId: "test",
          operations: [{ seq: 2, action: { type: "add", card: a } }],
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await post({
          clientId: "test",
          operations: [
            { seq: 1, action: { type: "add", card: { ...a, kind: "shell" } } },
          ],
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await post({ clientId: "../escape", operations: [] })).statusCode,
      400,
    );
    assert.deepEqual((await app.inject("/api/session/tabs")).json().cards, []);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("followed sessions keep a durable backup and corrupt records cannot be reset by clients", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "followed-tabs-backup-"));
  const file = join(dir, "tabs.json");
  let app = Fastify();
  registerSessionTabsRoutes(app, { file });
  try {
    await app.inject({
      method: "POST",
      url: "/api/session/tabs",
      payload: { clientId: "desktop", seed: [a], operations: [] },
    });
    await app.inject({
      method: "POST",
      url: "/api/session/tabs",
      payload: {
        clientId: "phone",
        operations: [{ seq: 1, action: { type: "add", card: b } }],
      },
    });
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, "utf8")).cards, [
      a,
    ]);
    await app.close();
    await writeFile(file, "{corrupt");
    app = Fastify();
    registerSessionTabsRoutes(app, { file });
    assert.ok((await app.inject("/api/session/tabs")).statusCode >= 500);
    assert.ok(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/tabs",
          payload: { clientId: "phone", operations: [] },
        })
      ).statusCode >= 500,
    );
    assert.equal(await readFile(file, "utf8"), "{corrupt");
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, "utf8")).cards, [
      a,
    ]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
