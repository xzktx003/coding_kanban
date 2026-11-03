import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { registerWorkspaceFileRoutes } from "./workspace-files.js";

test("local file routes browse and edit without expanding project or environment APIs", async () => {
  const base = await mkdtemp(join(tmpdir(), "kanban-local-route-"));
  const project = join(base, "project"),
    other = join(base, "other");
  await mkdir(project);
  await mkdir(other);
  const path = join(other, "file.txt");
  await writeFile(path, "initial");
  const app = Fastify();
  registerWorkspaceFileRoutes(app, {
    trashHome: join(base, "trash"),
    roots: async () => [project],
  });
  const post = (scope: string, action: string, body: object) =>
    app.inject({
      method: "POST",
      url: `/api/session/${scope}/${action}`,
      payload: body,
    });
  try {
    assert.equal(
      (await post("workspace-files", "read", { root: project, path }))
        .statusCode,
      403,
    );
    const resolved = await post("local-files", "resolve", {
      root: project,
      path,
    });
    assert.equal(resolved.statusCode, 200);
    assert.deepEqual(resolved.json(), { root: "/", path });
    const relative = await post("local-files", "resolve", {
      root: project,
      path: "../other/file.txt",
    });
    assert.equal(relative.statusCode, 200);
    assert.deepEqual(relative.json(), { root: "/", path });
    const read = await post("local-files", "read", { root: "/", path });
    assert.equal(read.json().content, "initial");
    assert.equal(
      (
        await post("local-files", "save", {
          root: "/",
          path,
          content: "edited",
          version: read.json().version,
        })
      ).statusCode,
      200,
    );
    assert.equal(await readFile(path, "utf8"), "edited");
    assert.equal(
      (await post("local-files", "environment-list", { root: "/" })).statusCode,
      404,
    );
    assert.equal(
      (await post("workspace-files", "read", { root: "/", path })).statusCode,
      400,
    );
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
});
