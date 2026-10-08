import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../app.js";
import { VsCodeWebUnavailableError } from "../services/vscode-web-manager.js";

test("workbench opens a project without creating a terminal session and forwards the LAN origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kanban-editor-"));
  const received: Array<{
    id: string;
    workingDirectory?: string;
    options: unknown;
  }> = [];
  const { app, registry } = buildServer({
    vsCodeWebManager: {
      ensureSession: async (
        session: { id: string; workingDirectory?: string },
        options: unknown,
      ) => {
        received.push({ ...session, options });
        return {
          provider: "code-server",
          url: "https://lan.example/vscode/",
          reused: received.length > 1,
          workingDirectory: session.workingDirectory,
        };
      },
      dispose: async () => {},
    } as never,
  });
  try {
    const count = registry.list().items.length;
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/workbench/vscode-web",
        payload: { path: directory },
        headers: { origin: "https://lan.example", host: "127.0.0.1:3000" },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().workingDirectory, directory);
      assert.equal(response.json().reused, i > 0);
    }
    assert.equal(received[0].id, received[1].id);
    assert.deepEqual(received[0].options, {
      requestHost: "lan.example",
      requestProtocol: "https",
    });
    assert.equal(registry.list().items.length, count);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("workbench rejects malformed paths, missing directories and files before launching", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kanban-editor-validation-"));
  const file = join(directory, "file");
  await writeFile(file, "fixture");
  let launched = false;
  const { app } = buildServer({
    vsCodeWebManager: {
      ensureSession: async () => {
        launched = true;
      },
      dispose: async () => {},
    } as never,
  });
  try {
    for (const path of [
      "",
      "relative/path",
      "/bad\npath",
      "/bad\0path",
      join(directory, "missing"),
      file,
      123,
      null,
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/workbench/vscode-web",
        payload: { path },
      });
      assert.equal(response.statusCode, 400, String(path));
    }
    assert.equal(launched, false);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("workbench reports VS Code Web runtime failures explicitly", async () => {
  const { app } = buildServer({
    vsCodeWebManager: {
      ensureSession: async () => {
        throw new VsCodeWebUnavailableError("editor unavailable");
      },
      dispose: async () => {},
    } as never,
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/workbench/vscode-web",
      payload: { path: tmpdir() },
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /editor unavailable/);
  } finally {
    await app.close();
  }
});

test("directory aliases resolve to one stable project workspace", async () => {
  const { symlink } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "kanban-editor-alias-"));
  const alias = directory + "-link";
  const ids: string[] = [];
  const { app } = buildServer({
    vsCodeWebManager: {
      ensureSession: async (session: {
        id: string;
        workingDirectory: string;
      }) => {
        ids.push(session.id);
        return {
          provider: "code-server",
          url: "https://lan.example/vscode/",
          reused: true,
          workingDirectory: session.workingDirectory,
        };
      },
      dispose: async () => {},
    } as never,
  });
  try {
    await symlink(directory, alias, "dir");
    for (const path of [directory, alias]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/workbench/vscode-web",
        payload: { path },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().workingDirectory, directory);
    }
    assert.equal(ids[0], ids[1]);
  } finally {
    await app.close();
    await rm(alias, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
