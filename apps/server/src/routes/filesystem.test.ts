import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "../app.js";

function createTempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "filesystem-routes-"));
}

test("filesystem routes list, preview, rename, and delete local files", async () => {
  const rootDir = createTempRoot();
  const sourcePath = path.join(rootDir, "example.txt");
  const renamedPath = path.join(rootDir, "renamed.txt");
  writeFileSync(sourcePath, "route preview");

  const { app } = buildServer();
  await app.ready();

  try {
    const listRes = await app.inject({
      method: "POST",
      url: "/api/fs/list",
      payload: {
        path: rootDir,
        showHidden: true,
      },
    });
    assert.equal(listRes.statusCode, 200);
    assert.equal(
      JSON.parse(listRes.payload).entries.some(
        (entry: { name: string }) => entry.name === "example.txt",
      ),
      true,
    );

    const previewRes = await app.inject({
      method: "POST",
      url: "/api/fs/preview",
      payload: {
        path: sourcePath,
      },
    });
    assert.equal(previewRes.statusCode, 200);
    assert.deepEqual(JSON.parse(previewRes.payload), {
      path: sourcePath,
      content: "route preview",
      encoding: "utf8",
      truncated: false,
      size: 13,
      mimeType: "text/plain",
      offset: 0,
      bytesRead: 13,
      previousOffset: null,
      nextOffset: null,
    });

    const renameRes = await app.inject({
      method: "POST",
      url: "/api/fs/operation",
      payload: {
        operation: "rename",
        path: sourcePath,
        newPath: renamedPath,
      },
    });
    assert.equal(renameRes.statusCode, 200);

    const downloadRes = await app.inject({
      method: "POST",
      url: "/api/fs/download",
      payload: {
        path: renamedPath,
      },
    });
    assert.equal(downloadRes.statusCode, 200);
    assert.equal(downloadRes.body, "route preview");

    const deleteRes = await app.inject({
      method: "POST",
      url: "/api/fs/operation",
      payload: {
        operation: "delete",
        path: renamedPath,
      },
    });
    assert.equal(deleteRes.statusCode, 200);

    const listAfterDeleteRes = await app.inject({
      method: "POST",
      url: "/api/fs/list",
      payload: {
        path: rootDir,
        showHidden: true,
      },
    });
    assert.equal(listAfterDeleteRes.statusCode, 200);
    assert.equal(
      JSON.parse(listAfterDeleteRes.payload).entries.some(
        (entry: { name: string }) => entry.name === "renamed.txt",
      ),
      false,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    await app.close();
  }
});

test("filesystem preview route accepts a bounded window offset", async () => {
  const rootDir = createTempRoot();
  const sourcePath = path.join(rootDir, "window.txt");
  writeFileSync(sourcePath, "first-second-third");

  const { app } = buildServer();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/fs/preview",
      payload: {
        path: sourcePath,
        offset: 6,
        maxBytes: 6,
      },
    });

    assert.equal(response.statusCode, 200);
    const preview = JSON.parse(response.payload);
    assert.equal(preview.content, "second");
    assert.equal(preview.offset, 6);
    assert.equal(preview.bytesRead, 6);
    assert.equal(preview.previousOffset, 0);
    assert.equal(preview.nextOffset, 12);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    await app.close();
  }
});

test("filesystem routes delegate remote list requests to the SFTP service", async () => {
  const calls: Array<{ path: string; showHidden?: boolean }> = [];
  const fakeSftpService = {
    list: async (_target: unknown, pathValue: string, showHidden?: boolean) => {
      calls.push({ path: pathValue, showHidden });
      return {
        path: "/remote/home",
        entries: [],
      };
    },
    mkdir: async () => "/remote/home/new-dir",
    rename: async () => "/remote/home/renamed",
    remove: async () => {},
    preview: async () => ({
      path: "/remote/home/file.txt",
      content: "remote",
      encoding: "utf8" as const,
      truncated: false,
      size: 6,
      mimeType: "text/plain",
      offset: 0,
      bytesRead: 6,
      previousOffset: null,
      nextOffset: null,
    }),
    chmod: async () => {},
    createReadStream: async () => {
      throw new Error("not used");
    },
    createWriteStream: async () => {
      throw new Error("not used");
    },
  };

  const { app } = buildServer({
    sftpService: fakeSftpService as never,
  });
  await app.ready();

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/fs/list",
      payload: {
        path: "~",
        showHidden: true,
        sshTarget: {
          host: "example.com",
          port: 22,
          username: "demo",
        },
      },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, [{ path: "~", showHidden: true }]);
  } finally {
    await app.close();
  }
});

test("filesystem routes keep distinct SSH identities separate in the SFTP service contract", async () => {
  const calls: string[] = [];
  const fakeSftpService = {
    list: async (target: { identityFile?: string }, pathValue: string) => {
      calls.push(`${target.identityFile ?? ""}:${pathValue}`);
      return {
        path: "/remote/home",
        entries: [],
      };
    },
    mkdir: async () => "/remote/home/new-dir",
    rename: async () => "/remote/home/renamed",
    remove: async () => {},
    preview: async () => ({
      path: "/remote/home/file.txt",
      content: "remote",
      encoding: "utf8" as const,
      truncated: false,
      size: 6,
      mimeType: "text/plain",
      offset: 0,
      bytesRead: 6,
      previousOffset: null,
      nextOffset: null,
    }),
    chmod: async () => {},
    createReadStream: async () => {
      throw new Error("not used");
    },
    createWriteStream: async () => {
      throw new Error("not used");
    },
  };

  const { app } = buildServer({
    sftpService: fakeSftpService as never,
  });
  await app.ready();

  try {
    await app.inject({
      method: "POST",
      url: "/api/fs/list",
      payload: {
        path: "~",
        sshTarget: {
          host: "example.com",
          port: 22,
          username: "demo",
          identityFile: "/tmp/key-a",
        },
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/fs/list",
      payload: {
        path: "~",
        sshTarget: {
          host: "example.com",
          port: 22,
          username: "demo",
          identityFile: "/tmp/key-b",
        },
      },
    });

    assert.deepEqual(calls, ["/tmp/key-a:~", "/tmp/key-b:~"]);
  } finally {
    await app.close();
  }
});
