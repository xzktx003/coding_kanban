import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { registerWorkspaceFileRoutes } from "./workspace-files.js";
test("workspace file routes validate roots, report save conflicts, upload safely and download bytes", async () => {
  const base = await mkdtemp(join(tmpdir(), "workspace-routes-")),
    root = join(base, "project");
  await mkdir(root);
  await writeFile(join(root, "a.txt"), "before");
  const app = Fastify();
  registerWorkspaceFileRoutes(app, {
    trashHome: join(base, "trash"),
    roots: async () => [root],
  });
  await app.ready();
  const req = (action: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/api/session/workspace-files/" + action,
      payload,
    });
  try {
    const snap = (await req("read", { root, path: "a.txt" })).json();
    assert.equal(snap.content, "before");
    await writeFile(join(root, "a.txt"), "agent");
    assert.equal(
      (
        await req("save", {
          root,
          path: "a.txt",
          content: "user",
          version: snap.version,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await req("create", { root, path: "b.txt", kind: "file" })).statusCode,
      200,
    );
    assert.equal(
      (
        await req("create", {
          root: pathOutside(base),
          path: "x",
          kind: "file",
        })
      ).statusCode,
      403,
    );
    const deleted = (await req("trash", { root, path: "b.txt" })).json();
    assert.equal(
      (await req("restore", { root, id: deleted.id })).statusCode,
      200,
    );
    const boundary = "isolated-boundary";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="root"\r\n\r\n${root}\r\n--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\nupload.txt\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.txt"\r\nContent-Type: application/octet-stream\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const upload = () =>
      app.inject({
        method: "POST",
        url: "/api/session/workspace-files/upload",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
    assert.equal((await upload()).statusCode, 200);
    assert.equal((await upload()).statusCode, 409);
    const download = await req("download", { root, path: "upload.txt" });
    assert.equal(download.body, "hello");
    assert.match(
      download.headers["content-disposition"] as string,
      /attachment/,
    );
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
});
function pathOutside(base: string) {
  return base;
}
