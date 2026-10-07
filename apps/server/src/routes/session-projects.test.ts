import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerSessionProjectsRoutes } from "./session-projects.js";

test("legacy projects migrate once, concurrent operations merge, restart restores and backup retains the prior state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "project-records-"));
  const file = join(dir, "projects.json"),
    legacyFile = join(dir, "settings.json");
  await writeFile(
    legacyFile,
    JSON.stringify({ workspace: { projects: ["/a", "/b"], cwd: "/a" } }),
  );
  let app = Fastify();
  registerSessionProjectsRoutes(app, { file, legacyFile });
  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/session/projects", payload });
  try {
    await post({ clientId: "desktop", seed: ["/stale"], operations: [] });
    assert.deepEqual(
      (await app.inject("/api/session/projects")).json().projects,
      ["/a", "/b"],
    );
    await Promise.all([
      post({
        clientId: "desktop",
        operations: [{ seq: 1, action: { type: "remove", path: "/a" } }],
      }),
      post({
        clientId: "phone",
        operations: [{ seq: 1, action: { type: "add", path: "/c" } }],
      }),
    ]);
    await post({
      clientId: "phone",
      operations: [
        { seq: 2, action: { type: "move", path: "/c", beforePath: "/b" } },
      ],
    });
    assert.deepEqual(
      (await app.inject("/api/session/projects")).json().projects,
      ["/c", "/b"],
    );
    assert.deepEqual(
      JSON.parse(await readFile(`${file}.bak`, "utf8")).projects,
      ["/b", "/c"],
    );
    await writeFile(
      legacyFile,
      JSON.stringify({ workspace: { projects: ["/a", "/b", "/stale"] } }),
    );
    await app.close();
    app = Fastify();
    registerSessionProjectsRoutes(app, { file, legacyFile });
    assert.deepEqual(
      (await app.inject("/api/session/projects")).json().projects,
      ["/c", "/b"],
    );
    await post({
      clientId: "desktop",
      operations: [{ seq: 1, action: { type: "remove", path: "/a" } }],
    });
    assert.deepEqual(
      (await app.inject("/api/session/projects")).json().projects,
      ["/c", "/b"],
    );
    assert.equal(
      (await post({ clientId: "phone", operations: [], cwd: "/b" })).statusCode,
      400,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt storage cannot be replaced with empty records and invalid paths/sequences are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "project-records-"));
  const file = join(dir, "projects.json");
  const app = Fastify();
  registerSessionProjectsRoutes(app, { file });
  try {
    for (const path of ["/bad\npath", "relative", "~/project"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/projects",
        payload: {
          clientId: "phone",
          operations: [{ seq: 1, action: { type: "add", path } }],
        },
      });
      assert.equal(response.statusCode, 400);
    }
    await writeFile(file, "{corrupt");
    assert.equal((await app.inject("/api/session/projects")).statusCode, 503);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/projects",
          payload: { clientId: "phone", operations: [] },
        })
      ).statusCode,
      503,
    );
    assert.equal(await readFile(file, "utf8"), "{corrupt");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
