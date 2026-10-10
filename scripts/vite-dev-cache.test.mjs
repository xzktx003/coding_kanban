import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";

test("independent Vite instances cannot replace each other's optimized chunks", async () => {
  const { resolveWebDevCacheDir } = await import("./vite-dev-cache.mjs");
  const root = await mkdtemp(join(tmpdir(), "kanban-vite-cache-"));
  try {
    const first = resolveWebDevCacheDir({
      projectRoot: root,
      mode: "development",
      instanceId: "123-" + "a".repeat(16),
    });
    const second = resolveWebDevCacheDir({
      projectRoot: root,
      mode: "development",
      instanceId: "456-" + "b".repeat(16),
    });
    await mkdir(join(first, "deps"), { recursive: true });
    await writeFile(
      join(first, "deps", "live-mermaid.js"),
      "first process chunk",
    );
    // A second optimizer regenerates its whole deps directory.
    await rm(join(second, "deps"), { recursive: true, force: true });
    await mkdir(join(second, "deps"), { recursive: true });
    await writeFile(
      join(second, "deps", "new-mermaid.js"),
      "second process chunk",
    );
    assert.equal(
      await readFile(join(first, "deps", "live-mermaid.js"), "utf8"),
      "first process chunk",
    );
    assert.notEqual(first, second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configuration reloads keep the process cache identity and canonical project directory", async () => {
  const first = await import("./vite-dev-cache.mjs?first-config");
  const second = await import("./vite-dev-cache.mjs?reloaded-config");
  assert.equal(first.webDevCacheInstanceId(), second.webDevCacheInstanceId());
  const root = await mkdtemp(join(tmpdir(), "kanban-vite-reload-"));
  try {
    const project = join(root, "project");
    await mkdir(project);
    await symlink(project, join(root, "alias"));
    const options = { projectRoot: project, mode: "development" };
    assert.equal(
      first.resolveWebDevCacheDir(options),
      second.resolveWebDevCacheDir({
        ...options,
        projectRoot: join(root, "alias"),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cache directories use bounded opaque names outside the shared node_modules cache", async () => {
  const { resolveWebDevCacheDir } = await import("./vite-dev-cache.mjs");
  const root = await mkdtemp(join(tmpdir(), "kanban-vite-path-"));
  try {
    const options = {
      projectRoot: root,
      mode: "../../outside",
      instanceId: "123-" + "a".repeat(16),
    };
    const directory = resolveWebDevCacheDir(options);
    assert.equal(
      resolve(directory, ".."),
      join(root, ".dev-runtime", "vite-cache"),
    );
    assert.ok(basename(directory).length <= 48);
    assert.notEqual(
      directory,
      join(root, "apps", "web", "node_modules", ".vite"),
    );
    for (const instanceId of [
      "../outside",
      "0-" + "a".repeat(16),
      "1-" + "a".repeat(200),
      "2147483648-" + "a".repeat(16),
    ])
      assert.throws(
        () => resolveWebDevCacheDir({ ...options, instanceId }),
        /instance/,
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
