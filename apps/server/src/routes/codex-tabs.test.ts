import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerCodexTabsRoutes } from "./codex-tabs.js";

const a = { id: "019aabcd-1234-7890-abcd-000000000001", cwd: "/tmp/project-a", title: "Alpha" };
const b = { id: "019aabcd-1234-7890-abcd-000000000002", cwd: "/tmp/project-b", title: "Beta" };

test("two browsers share Codex threads, retry idempotently, restore order and reject local layout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-tabs-"));
  const file = join(dir, "codex-followed-threads.json");
  let app = Fastify();
  registerCodexTabsRoutes(app, { file });
  const send = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/native-codex/tabs", payload });
  try {
    assert.equal((await app.inject("/api/native-codex/tabs")).json().initialized, false);
    await send({ clientId: "browser-a", seed: [a], operations: [] });
    await send({ clientId: "browser-b", seed: [b], operations: [] });
    assert.deepEqual((await app.inject("/api/native-codex/tabs")).json().threads, [a]);
    const add = { clientId: "browser-b", operations: [{ seq: 1, action: { type: "add", thread: b } }] };
    assert.equal((await send(add)).statusCode, 200);
    await Promise.all([
      send({ clientId: "browser-a", operations: [{ seq: 1, action: { type: "remove", id: a.id } }] }),
      send(add),
    ]);
    assert.deepEqual((await app.inject("/api/native-codex/tabs")).json().threads, [b]);
    await send({
      clientId: "browser-a",
      operations: [
        { seq: 2, action: { type: "add", thread: a } },
        { seq: 3, action: { type: "move", id: a.id, beforeId: b.id } },
      ],
    });
    assert.deepEqual((await app.inject("/api/native-codex/tabs")).json().threads, [a, b]);
    assert.equal((await send({
      clientId: "browser-b", operations: [], activeId: a.id, layout: "split",
    })).statusCode, 400);
    await app.close();
    app = Fastify();
    registerCodexTabsRoutes(app, { file });
    assert.deepEqual((await app.inject("/api/native-codex/tabs")).json().threads, [a, b]);
    await send(add);
    assert.deepEqual((await app.inject("/api/native-codex/tabs")).json().threads, [a, b]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Codex tab batches stay atomic and reject blank chats, bad paths and sequence gaps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-tabs-"));
  const app = Fastify();
  registerCodexTabsRoutes(app, { file: join(dir, "tabs.json") });
  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/native-codex/tabs", payload });
  try {
    assert.equal((await post({
      clientId: "test", operations: [{ seq: 2, action: { type: "add", thread: a } }],
    })).statusCode, 409);
    assert.equal((await post({
      clientId: "test", operations: [{ seq: 1, action: { type: "add", thread: { ...a, id: "new:blank" } } }],
    })).statusCode, 400);
    assert.equal((await post({
      clientId: "test", operations: [{ seq: 1, action: { type: "add", thread: { ...a, cwd: "relative" } } }],
    })).statusCode, 400);
    assert.equal((await post({ clientId: "../escape", operations: [] })).statusCode, 400);
    assert.deepEqual((await app.inject("/api/native-codex/tabs")).json().threads, []);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt Codex tab records stay untouched and the previous backup remains readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-tabs-backup-"));
  const file = join(dir, "tabs.json");
  let app = Fastify();
  registerCodexTabsRoutes(app, { file });
  try {
    await app.inject({ method: "POST", url: "/api/native-codex/tabs", payload: { clientId: "browser-a", seed: [a], operations: [] } });
    await app.inject({ method: "POST", url: "/api/native-codex/tabs", payload: {
      clientId: "browser-b", operations: [{ seq: 1, action: { type: "add", thread: b } }],
    } });
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, "utf8")).threads, [a]);
    await app.close();
    await writeFile(file, "{corrupt");
    app = Fastify();
    registerCodexTabsRoutes(app, { file });
    assert.ok((await app.inject("/api/native-codex/tabs")).statusCode >= 500);
    assert.ok((await app.inject({ method: "POST", url: "/api/native-codex/tabs", payload: { clientId: "browser-b", operations: [] } })).statusCode >= 500);
    assert.equal(await readFile(file, "utf8"), "{corrupt");
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, "utf8")).threads, [a]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
