import { test } from "node:test";
import assert from "node:assert/strict";
import { watch } from "node:fs";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { FileWatches } from "./file-watches.js";
import { pollingFileWatcher } from "./polling-file-watcher.js";
for (const code of ["EMFILE", "ENOSPC"])
  test(`file-watch quota ${code} preserves real create/modify/remove events with bounded polling`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "kanban-watch-quota-"));
    const hub = new EventHub();
    let attempts = 0;
    const nativeWatch = (() => {
      attempts++;
      throw Object.assign(new Error("watch quota exhausted"), { code });
    }) as typeof watch;
    const watches = new FileWatches(hub, {
      watch: nativeWatch,
      pollIntervalMs: 25,
    });
    t.after(async () => {
      watches.close();
      hub.close();
      await rm(root, { recursive: true, force: true });
    });
    await Promise.all([watches.watch(root), watches.watch(root)]);
    assert.equal(attempts, 1);
    assert.equal(watches.count, 1);
    const subscription = hub.subscribe({ agents: "fs" });
    async function check(kind: string, change: () => Promise<unknown>) {
      const next = subscription.next();
      await change();
      let timer: ReturnType<typeof setTimeout>;
      try {
        const event = await Promise.race([
          next,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`missing ${kind} event`)),
              2000,
            );
          }),
        ]);
        assert.equal(event.value?.event, "fs_change");
        assert.deepEqual(event.value?.payload, {
          path: join(root, "note.txt"),
          kind,
        });
      } finally {
        clearTimeout(timer!);
      }
    }
    await check("create", () => writeFile(join(root, "note.txt"), "first"));
    await check("modify", () =>
      writeFile(join(root, "note.txt"), "modified content"),
    );
    await check("remove", () => unlink(join(root, "note.txt")));
    await watches.unwatch(root);
    assert.equal(watches.count, 1);
    await watches.unwatch(root);
    assert.equal(watches.count, 0);
  });
test("ordinary watch errors still reject rather than pretending that a path is watched", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-watch-error-"));
  const hub = new EventHub();
  const watches = new FileWatches(hub, {
    watch: (() => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    }) as typeof watch,
  });
  t.after(async () => {
    watches.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(watches.watch(root), /denied/);
  assert.equal(watches.count, 0);
});
test("quota fallback refuses an oversized metadata snapshot without reserving its budget", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-watch-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "one"), "one");
  await writeFile(join(root, "two"), "two");
  const budget = { entries: 0, limit: 1 };
  await assert.rejects(
    pollingFileWatcher(root, {
      intervalMs: 25,
      budget,
      changed: () => assert.fail("unexpected change"),
      error: () => assert.fail("unexpected timer"),
    }),
    /entry limit/,
  );
  assert.equal(budget.entries, 0);
});
