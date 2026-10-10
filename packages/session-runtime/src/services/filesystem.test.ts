import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRuntime } from "../server.js";
import { FileWatches } from "./file-watches.js";
import { EventHub } from "../core/events.js";

test("filesystem HTTP contract preserves directory metadata, JSON strings, binary bytes and write/delete behavior", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-ts-files-"));
  const runtime = await createRuntime({
    dataHome: join(root, "data"),
    instance: "files",
  });
  t.after(async () => {
    await runtime.app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "a.txt"), "第一行\r\nsecond\n");
  await writeFile(join(root, "raw.png"), Buffer.from([0, 255, 10]));
  const call = (path: string, payload: object) =>
    runtime.app.inject({
      method: "POST",
      url: `/api/filesystem/${path}`,
      payload,
    });
  const entries = (await call("read-directory", { path: root })).json();
  assert.ok(
    entries.findIndex((entry: { name: string }) => entry.name === "folder") <
      entries.findIndex((entry: { name: string }) => entry.name === "a.txt"),
  );
  assert.deepEqual(
    entries.find((e: { name: string }) => e.name === "folder"),
    {
      name: "folder",
      path: join(root, "folder"),
      is_dir: true,
      size: null,
      extension: null,
    },
  );
  assert.equal(
    (await call("read-text-file", { filePath: join(root, "a.txt") })).json(),
    "第一行\r\nsecond\n",
  );
  assert.deepEqual(
    (
      await call("read-text-file-lines", { filePath: join(root, "a.txt") })
    ).json(),
    ["第一行", "second"],
  );
  await writeFile(join(root, "bare-cr.txt"), "last\r");
  assert.deepEqual(
    (
      await call("read-text-file-lines", {
        filePath: join(root, "bare-cr.txt"),
      })
    ).json(),
    ["last\r"],
  );
  assert.equal(
    (await call("read-file", { filePath: join(root, "raw.png") })).json(),
    "AP8K",
  );
  const asset = await runtime.app.inject({
    method: "GET",
    url: `/api/filesystem/asset?path=${encodeURIComponent(join(root, "raw.png"))}`,
  });
  assert.equal(asset.headers["content-type"], "image/png");
  assert.deepEqual(asset.rawPayload, Buffer.from([0, 255, 10]));
  const target = join(root, "folder", "new", "note.md");
  assert.equal(
    (await call("write-file", { filePath: target, content: "saved" }))
      .statusCode,
    200,
  );
  assert.equal(await readFile(target, "utf8"), "saved");
  assert.equal(
    (await call("delete-file", { filePath: target })).statusCode,
    200,
  );
  assert.ok(
    (await call("delete-file", { filePath: join(root, "folder") }))
      .statusCode >= 400,
  );
  assert.equal(
    (await call("read-directory", { path: "relative/path" })).statusCode,
    400,
  );
  assert.ok(
    (
      await call("write-file", {
        filePath: join(root, "raw.png"),
        content: "damage",
      })
    ).statusCode >= 400,
  );
  await writeFile(join(root, "invalid.txt"), Buffer.from([255]));
  assert.ok(
    (await call("read-text-file", { filePath: join(root, "invalid.txt") }))
      .statusCode >= 400,
  );
  await writeFile(join(root, "large.txt"), "x".repeat(1024 * 1024 + 1));
  assert.ok(
    (await call("read-text-file", { filePath: join(root, "large.txt") }))
      .statusCode >= 400,
  );
});

test("file watches share concurrent registrations, canonical aliases, bounded traversal and actual events", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-ts-watches-"));
  const hub = new EventHub();
  const watches = new FileWatches(hub, { maxDirectories: 2 });
  t.after(async () => {
    watches.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  });
  const watched = join(root, "watched");
  await mkdir(watched);
  const alias = join(root, "alias");
  await symlink(watched, alias);
  await Promise.all([watches.watch(watched), watches.watch(alias)]);
  assert.equal(watches.count, 1);
  await watches.unwatch(alias);
  assert.equal(watches.count, 1);
  const subscription = hub.subscribe({ agents: "fs" });
  const next = subscription.next();
  await writeFile(join(watched, "new.txt"), "change");
  let timer: ReturnType<typeof setTimeout>;
  const event = await Promise.race([
    next,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("watch event timeout")), 3000);
    }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(event.value?.event, "fs_change");
  assert.equal(event.value?.payload.path, join(watched, "new.txt"));
  await watches.unwatch(watched);
  assert.equal(watches.count, 0);
  subscription.close();
  for (let i = 0; i < 4; i++) await mkdir(join(watched, String(i)));
  assert.equal(await watches.allowsRecursive(watched), false);
  // The root can disappear before the matching unwatch; ownership is still released.
  await watches.watch(watched);
  await rm(watched, { recursive: true });
  await watches.unwatch(watched);
  assert.equal(watches.count, 0);
});
