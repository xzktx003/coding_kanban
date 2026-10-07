import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerWorkspaceFileRoutes } from "./workspace-files.js";
test("visualization reads are bounded HTML files within a registered project", async () => {
  const base = await mkdtemp(join(tmpdir(), "kanban-viz-")),
    root = join(base, "project");
  await mkdir(root);
  const app = Fastify();
  registerWorkspaceFileRoutes(app, {
    trashHome: join(base, "trash"),
    roots: async () => [root],
  });
  const read = (path: string, project = root) =>
    app.inject({
      method: "POST",
      url: "/api/session/workspace-files/visualization",
      payload: { root: project, path },
    });
  try {
    await writeFile(join(root, "good.html"), "<div>fixture</div>");
    await writeFile(join(root, "note.txt"), "private");
    await writeFile(join(root, "big.html"), "a".repeat(1_000_001));
    await writeFile(join(base, "outside.html"), "outside");
    await symlink(join(base, "outside.html"), join(root, "link.html"));
    const response = await read(join(root, "good.html"));
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().content, "<div>fixture</div>");
    assert.equal((await read(join(root, "note.txt"))).statusCode, 415);
    assert.equal((await read(join(root, "big.html"))).statusCode, 413);
    assert.equal((await read(join(base, "outside.html"))).statusCode, 403);
    assert.equal((await read(join(root, "link.html"))).statusCode, 403);
    assert.equal((await read(join(root, "missing.html"))).statusCode, 404);
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
});
