import { afterEach, expect, it, vi } from "vitest";
import {
  contextDraftStorage as storage,
  emptyRecord,
  revised,
  CONTEXT_DATABASE,
  type ContextRecord,
} from "./draftStorage";
const owner = () => "context-test:" + crypto.randomUUID();
const context = (id: string, text = id) =>
  revised({ id, text, name: id, kind: "file" as const, path: "/" + id });
afterEach(() => vi.restoreAllMocks());
it("merges two pages adding to the same owner and exact clear preserves a replacement with unchanged text", async () => {
  const key = owner(),
    a = await storage.load(key),
    b = await storage.load(key);
  await storage.save(key, a, { ...a, contexts: [context("a")] });
  await storage.save(key, b, { ...b, contexts: [context("b")] });
  const before = await storage.load(key);
  expect(before.contexts.map((c) => c.value.id)).toEqual(["a", "b"]);
  const updated = {
    ...before,
    contexts: before.contexts.map((c) =>
      c.value.id === "a"
        ? revised({
            ...c.value,
            path: "/new-path",
            range: { start: 3, end: 5 },
          })
        : c,
    ),
  };
  await storage.save(key, before, updated);
  await storage.save(key, before, {
    ...before,
    contexts: before.contexts.filter((c) => c.value.id !== "a"),
  });
  expect(
    (await storage.load(key)).contexts.find((c) => c.value.id === "a")?.value
      .path,
  ).toBe("/new-path");
});
it("a stale update cannot resurrect a removed context and leaves the other page intact", async () => {
  const key = owner(),
    initial = { ...emptyRecord(), contexts: [context("a")] };
  await storage.save(key, emptyRecord(), initial);
  const before = await storage.load(key);
  await storage.save(key, before, { ...before, contexts: [] });
  await expect(
    storage.save(key, before, {
      ...before,
      contexts: [context("a", "late changed")],
    }),
  ).rejects.toThrow("另一页面");
  expect((await storage.load(key)).contexts).toEqual([]);
});
it("merges independent marks and rejects an incompatible edit of the same mark without partial writes", async () => {
  const key = owner();
  const document = { version: 1 as const, width: 100, height: 100, marks: [] };
  const mark = (id: string, color = "#000") => ({
    id,
    kind: "pen" as const,
    points: [{ x: 1, y: 2 }],
    width: 2,
    color,
  });
  const before = { ...emptyRecord(), drawings: { sketch: revised(document) } };
  await storage.save(key, emptyRecord(), before);
  const a = {
    ...before,
    drawings: { sketch: revised({ ...document, marks: [mark("a")] }) },
  };
  const b = {
    ...before,
    drawings: { sketch: revised({ ...document, marks: [mark("b")] }) },
  };
  await storage.save(key, before, a);
  await storage.save(key, before, b);
  const merged = await storage.load(key);
  expect(merged.drawings.sketch.value.marks.map((m) => m.id)).toEqual([
    "a",
    "b",
  ]);
  const next = (color: string): ContextRecord => ({
    ...merged,
    drawings: {
      sketch: revised({
        ...merged.drawings.sketch.value,
        marks: [mark("a", color), mark("b")],
      }),
    },
  });
  await storage.save(key, merged, next("#f00"));
  await expect(storage.save(key, merged, next("#0f0"))).rejects.toThrow(
    "另一页面",
  );
  expect((await storage.load(key)).drawings.sketch.value.marks[0].color).toBe(
    "#f00",
  );
});
it("a destination quota failure aborts both owners and a retry retains source and destination data", async () => {
  const from = owner(),
    to = owner();
  const source = { ...emptyRecord(), contexts: [context("source")] },
    target = { ...emptyRecord(), contexts: [context("target")] };
  await storage.save(from, emptyRecord(), source);
  await storage.save(to, emptyRecord(), target);
  const put = IDBObjectStore.prototype.put;
  const mock = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.transaction.db.name === CONTEXT_DATABASE && key === to)
        throw new DOMException("quota", "QuotaExceededError");
      return put.call(this, value, key);
    });
  await expect(storage.move(from, to, source)).rejects.toThrow("quota");
  mock.mockRestore();
  expect((await storage.load(from)).contexts).toHaveLength(1);
  expect((await storage.load(to)).contexts).toHaveLength(1);
  await storage.move(from, to, source);
  expect((await storage.load(from)).contexts).toHaveLength(0);
  expect((await storage.load(to)).contexts).toHaveLength(2);
});
it("keeps the old backup read-only and an empty migrated row cannot be revived by an old page", async () => {
  const key = owner(),
    legacy = {
      contexts: [context("old").value],
      drawings: {},
      expanded: false,
      plain: false,
    };
  const raw = JSON.stringify({ [key]: legacy });
  localStorage.setItem("kanban.session.composer-v2", raw);
  const before = await storage.load(key);
  await storage.save(key, before, { ...before, contexts: [] });
  localStorage.setItem("kanban.session.composer-v2", raw);
  expect((await storage.load(key)).contexts).toEqual([]);
  expect(localStorage.getItem("kanban.session.composer-v2")).toBe(raw);
});
