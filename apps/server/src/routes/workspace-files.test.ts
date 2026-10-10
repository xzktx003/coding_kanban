import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
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
    const info = await req("download-info", { root, path: "upload.txt" });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().filename, "upload.txt");
    const getDownload = await app.inject({
      method: "GET",
      url:
        "/api/session/workspace-files/download?root=" +
        encodeURIComponent(root) +
        "&path=" +
        encodeURIComponent("upload.txt"),
    });
    assert.equal(getDownload.statusCode, 200);
    assert.equal(getDownload.body, "hello");
    assert.match(
      getDownload.headers["content-disposition"] as string,
      /upload\.txt/,
    );
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
});
test("workspace file routes stream folder downloads as zip without leaking symlinks", async () => {
  const base = await mkdtemp(join(tmpdir(), "workspace-routes-")),
    root = join(base, "project");
  await mkdir(join(root, "dir"), { recursive: true });
  await writeFile(join(root, "dir", "a.txt"), "inside");
  await writeFile(join(base, "secret.txt"), "secret");
  await symlink(join(base, "secret.txt"), join(root, "dir", "secret-link"));
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
    const info = await req("download-info", { root, path: "dir" });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().filename, "dir.zip");
    const download = await app.inject({
      method: "GET",
      url:
        "/api/session/workspace-files/download?root=" +
        encodeURIComponent(root) +
        "&path=" +
        encodeURIComponent("dir"),
    });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers["content-type"], "application/zip");
    assert.match(download.headers["content-disposition"] as string, /dir\.zip/);
    assert.match(download.rawPayload.toString("latin1"), /a\.txt/);
    assert.doesNotMatch(download.rawPayload.toString("latin1"), /secret-link/);
    assert.doesNotMatch(download.rawPayload.toString("utf8"), /secret/);
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
});
test("workspace file GET download releases streams when the client aborts", async () => {
  const base = await mkdtemp(join(tmpdir(), "workspace-routes-")),
    root = join(base, "project");
  await mkdir(root);
  await writeFile(join(root, "large.bin"), Buffer.alloc(8 * 1024 * 1024, 7));
  const app = Fastify();
  registerWorkspaceFileRoutes(app, {
    trashHome: join(base, "trash"),
    roots: async () => [root],
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const request = http.get({
      host: "127.0.0.1",
      port: address.port,
      path:
        "/api/session/workspace-files/download?root=" +
        encodeURIComponent(root) +
        "&path=" +
        encodeURIComponent("large.bin"),
    });
    request.on("error", () => {});
    const [response] = (await once(request, "response")) as [
      http.IncomingMessage,
    ];
    response.on("error", () => {});
    const closed = new Promise<void>((resolve) =>
      response.once("close", resolve),
    );
    response.once("data", () => request.destroy());
    await closed;
    await app.close();
  } finally {
    await app.close().catch(() => {});
    await rm(base, { recursive: true, force: true });
  }
});
test("workspace file GET download stops preparing a zip when the client aborts early", async () => {
  const base = await mkdtemp(join(tmpdir(), "workspace-routes-")),
    root = join(base, "project");
  await mkdir(join(root, "dir"), { recursive: true });
  await writeFile(join(root, "dir", "a.txt"), "inside");
  let releaseRoots!: () => void;
  const rootsReleased = new Promise<void>((resolve) => {
    releaseRoots = resolve;
  });
  let rootsStarted!: () => void;
  const rootsPending = new Promise<void>((resolve) => {
    rootsStarted = resolve;
  });
  let rootsCalls = 0;
  const app = Fastify();
  registerWorkspaceFileRoutes(app, {
    trashHome: join(base, "trash"),
    roots: async () => {
      rootsCalls += 1;
      if (rootsCalls === 1) {
        rootsStarted();
        await rootsReleased;
      }
      return [root];
    },
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const request = http.get({
      host: "127.0.0.1",
      port: address.port,
      path:
        "/api/session/workspace-files/download?root=" +
        encodeURIComponent(root) +
        "&path=" +
        encodeURIComponent("dir"),
    });
    request.on("error", () => {});
    const closed = new Promise<void>((resolve) =>
      request.once("close", resolve),
    );
    await rootsPending;
    request.destroy();
    releaseRoots();
    await closed;
    await app.close();
  } finally {
    releaseRoots?.();
    await app.close().catch(() => {});
    await rm(base, { recursive: true, force: true });
  }
});
function pathOutside(base: string) {
  return base;
}
