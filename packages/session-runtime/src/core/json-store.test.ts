import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JsonStore } from "./json-store.js";

test("settings keep the legacy layout, unknown fields, and serialize concurrent updates", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-ts-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, ".codexia", "settings.json");
  const store = new JsonStore(path, () => ({
    version: 1,
    workspace: { projects: [] },
  }));
  assert.equal((await store.read()).version, 1);
  await store.write({ version: 1, remote: { futureField: true }, count: 0 });
  await Promise.all(
    Array.from({ length: 20 }, () =>
      store.update((value) => ({ ...value, count: Number(value.count) + 1 })),
    ),
  );
  const actual = JSON.parse(await readFile(path, "utf8"));
  assert.equal(actual.count, 20);
  assert.deepEqual(actual.remote, { futureField: true });
  assert.deepEqual(await readdir(join(root, ".codexia")), ["settings.json"]);
});

test("corrupt existing data is surfaced and never replaced with defaults", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-ts-corrupt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "settings.json");
  const store = new JsonStore(path, () => ({}));
  await writeFile(path, "{broken");
  await assert.rejects(store.read(), /JSON/);
  await assert.rejects(
    store.update((value) => ({ ...value, changed: true })),
    /JSON/,
  );
  assert.equal(await readFile(path, "utf8"), "{broken");
  await writeFile(path, '{"recovered":true}');
  await store.update((value) => ({ ...value, count: 1 }));
  assert.deepEqual(await store.read(), { recovered: true, count: 1 });
});
