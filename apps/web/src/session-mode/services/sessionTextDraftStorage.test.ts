import { beforeEach, expect, it, vi } from "vitest";
import { createSessionTextDraftStorage } from "./sessionTextDraftStorage";

const name = "kanban.session.text-drafts";
const draft = (text: string, revision = 1) => ({ text, revision });
const value = (
  drafts: Record<string, ReturnType<typeof draft>>,
  migrated: string[] = [],
) => ({
  version: 1,
  state: { drafts, migrated },
});
beforeEach(() => localStorage.clear());

it("persists only the changed owner while preserving a large legacy draft collection", () => {
  const legacy = value(
    Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [
        `old-${i}`,
        draft("legacy ".repeat(700)),
      ]),
    ),
  );
  const backup = JSON.stringify(legacy);
  localStorage.setItem(name, backup);
  const storage = createSessionTextDraftStorage(vi.fn());
  const restored = storage.getItem(name)! as typeof legacy;
  const spy = vi.spyOn(Storage.prototype, "setItem");
  const next = value({ ...restored.state.drafts, active: draft("new input") });
  storage.setItem(name, next);
  expect(
    spy.mock.calls.reduce((n, [, data]) => n + data.length, 0),
  ).toBeLessThan(1024);
  expect(spy.mock.calls.some(([key]) => key === name)).toBe(false);
  spy.mockClear();
  storage.setItem(name, next);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  expect(localStorage.getItem(name)).toBe(backup);
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(next);
});

it("keeps independent owners edited by two pages without overwriting the other page", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  a.setItem(name, value({ a: draft("A first") }));
  b.setItem(name, value({ b: draft("B first") }));
  a.setItem(name, value({ a: draft("A latest", 2) }));
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ a: draft("A latest", 2), b: draft("B first") }),
  );
});

it("does not revive a cleared or moved legacy draft on reload", () => {
  localStorage.setItem(
    name,
    JSON.stringify(value({ from: draft("move me"), clear: draft("clear me") })),
  );
  const storage = createSessionTextDraftStorage(vi.fn());
  storage.getItem(name);
  storage.setItem(name, value({ to: draft("move me"), clear: draft("", 2) }));
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ to: draft("move me"), clear: draft("", 2) }),
  );
});

it("leaves the persisted source intact if saving a move destination fails and supports retry", () => {
  const onError = vi.fn();
  const storage = createSessionTextDraftStorage(onError);
  storage.getItem(name);
  storage.setItem(name, value({ from: draft("keep me") }));
  const next = value({ to: draft("keep me") });
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  storage.setItem(name, next);
  expect(onError).toHaveBeenCalledTimes(1);
  spy.mockRestore();
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ from: draft("keep me") }),
  );
  storage.setItem(name, next);
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(next);
});

it("merges migration markers from other pages and clears both formats only when explicitly requested", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  a.setItem(name, value({ a: draft("A") }, ["codex"]));
  b.setItem(name, value({ b: draft("B") }, ["cc"]));
  expect(
    (createSessionTextDraftStorage(vi.fn()).getItem(name) as any).state
      .migrated,
  ).toEqual(["codex", "cc"]);
  localStorage.setItem("unrelated", "keep");
  a.removeItem(name);
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem("unrelated")).toBe("keep");
});

it("does not overwrite unreadable saved data and can recover after an explicit rehydrate", () => {
  localStorage.setItem(name, "broken backup");
  const onError = vi.fn();
  const storage = createSessionTextDraftStorage(onError);
  expect(() => storage.getItem(name)).toThrow();
  const spy = vi.spyOn(Storage.prototype, "setItem");
  storage.setItem(name, value({ active: draft("still in memory") }));
  expect(spy).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalled();
  spy.mockRestore();
  localStorage.setItem(name, JSON.stringify(value({ old: draft("restored") })));
  storage.getItem(name);
  storage.setItem(
    name,
    value({ old: draft("restored"), active: draft("saved now") }),
  );
  expect(
    (createSessionTextDraftStorage(vi.fn()).getItem(name) as any).state.drafts
      .active.text,
  ).toBe("saved now");
});

it("does not replay a successful owner write over another page after a partial failure", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  const original = Storage.prototype.setItem;
  const spy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, text) {
      if (key.endsWith(".entry.y")) throw new Error("quota");
      original.call(this, key, text);
    });
  const x1 = draft("first page old text");
  a.setItem(name, value({ x: x1, y: draft("not yet saved") }));
  spy.mockRestore();
  b.setItem(name, value({ x: draft("second page newer text", 2) }));
  a.setItem(name, value({ x: x1, y: draft("first page retry", 2) }));
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({
      x: draft("second page newer text", 2),
      y: draft("first page retry", 2),
    }),
  );
});
