import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerSessionGroupsRoutes } from "./session-groups.js";

test("groups survive restart so another device reads the same grouping, and invalid input is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "session-groups-"));
  const file = join(dir, "groups.json");
  let app = Fastify();
  registerSessionGroupsRoutes(app, { file });
  const save = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/session-groups", payload });
  try {
    assert.deepEqual((await app.inject("/api/session-groups")).json(), {
      initialized: false,
      revision: 0,
      groups: [],
      assignments: {},
      collapsedGroupIds: [],
    });

    assert.equal(
      (
        await save({
          groups: [
            { id: "group-backend", name: "后端" },
            { id: "group-frontend", name: "前端" },
          ],
          assignments: {
            "session:backend": "group-backend",
            "session:ghost": "group-missing",
          },
          collapsedGroupIds: ["group-frontend", "group-missing"],
        })
      ).statusCode,
      200,
    );

    await app.close();
    app = Fastify();
    registerSessionGroupsRoutes(app, { file });

    // The phone reads the desktop grouping, with unknown references dropped.
    assert.deepEqual((await app.inject("/api/session-groups")).json(), {
      initialized: true,
      revision: 1,
      groups: [
        { id: "group-backend", name: "后端" },
        { id: "group-frontend", name: "前端" },
      ],
      assignments: { "session:backend": "group-backend" },
      collapsedGroupIds: ["group-frontend"],
    });

    assert.equal((await save({ groups: [], unexpected: 1 })).statusCode, 400);
    assert.equal((await save({ groups: "nope" })).statusCode, 400);
    // A rejected write must not disturb the stored grouping.
    assert.deepEqual(
      (await app.inject("/api/session-groups")).json().assignments,
      { "session:backend": "group-backend" },
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing storage reports unavailable instead of silently dropping groups", async () => {
  const app = Fastify();
  registerSessionGroupsRoutes(app, {});
  try {
    assert.equal((await app.inject("/api/session-groups")).statusCode, 503);
  } finally {
    await app.close();
  }
});

test("independent device operations merge and retries do not replay older changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "session-groups-ops-"));
  let app = Fastify();
  const file = join(dir, "groups.json");
  registerSessionGroupsRoutes(app, { file });
  const apply = (clientId: string, action: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/session-groups",
      payload: { clientId, operations: [{ seq: 1, action }] },
    });
  try {
    const addA = { type: "add", group: { id: "group-a", name: "A" } };
    const addB = { type: "add", group: { id: "group-b", name: "B" } };
    const results = await Promise.all([apply("device_a_1", addA), apply("device_b_1", addB)]);
    assert.deepEqual(results.map((response) => response.statusCode), [200, 200]);
    assert.equal((await apply("device_a_2", { type: "remove", groupId: "group-a" })).statusCode, 200);
    await app.close();
    app = Fastify();
    registerSessionGroupsRoutes(app, { file });
    // Retrying the lost add acknowledgement must not resurrect the deleted group.
    assert.equal((await apply("device_a_1", addA)).statusCode, 200);
    const snapshot = (await app.inject("/api/session-groups")).json();
    assert.deepEqual(snapshot.groups, [{ id: "group-b", name: "B" }]);
    assert.equal(snapshot.initialized, true);
    assert.equal((await apply("device_b_2", { type: "assign", sessionKeys: ["session:one"], groupId: "group-b" })).statusCode, 200);
    assert.equal((await apply("device_b_3", { type: "setCollapsed", key: "kanban:group:group-b", collapsed: true })).statusCode, 200);
    const after = (await app.inject("/api/session-groups")).json();
    assert.deepEqual(after.assignments, { "session:one": "group-b" });
    assert.deepEqual(after.collapsedGroupIds, ["kanban:group:group-b"]);
    assert.equal((await app.inject({ method: "POST", url: "/api/session-groups", payload: { groups: [], assignments: {}, collapsedGroupIds: [] } })).statusCode, 409);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
