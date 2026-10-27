import { beforeEach, expect, it, vi } from "vitest";
import {
  createSessionTextDraftStorage,
  type TextDraft,
} from "./sessionTextDraftStorage";

const name = "kanban.session.text-drafts";
const draft = (text: string, revision = 1) => ({ text, revision });
const value = (drafts: Record<string, TextDraft>, migrated: string[] = []) => ({
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

it("clears only the submitted edit even when another page writes between the read and marker write", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  const submitted = { ...draft("sent"), writeId: "a" };
  const newer = { ...draft("new draft", 2), writeId: "b" };
  a.setItem(name, value({ owner: submitted }));
  const original = Storage.prototype.setItem;
  const spy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, text) {
      if (key.includes(".cleared.")) b.setItem(name, value({ owner: newer }));
      original.call(this, key, text);
    });
  expect(a.clearSubmitted(name, "owner", submitted)).toEqual(newer);
  spy.mockRestore();
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ owner: newer }),
  );
  expect(
    Object.keys(localStorage).filter((key) => key.includes(".cleared.")),
  ).toHaveLength(0);
});

it("an old acknowledgement cannot undo another page's acknowledgement of a newer edit", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  const first = { ...draft("first"), writeId: "first" };
  const second = { ...draft("second", 2), writeId: "second" };
  a.setItem(name, value({ owner: first }));
  const original = Storage.prototype.setItem;
  let raced = false;
  const spy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, text) {
      if (key.endsWith(".first") && !raced) {
        raced = true;
        b.setItem(name, value({ owner: second }));
        b.clearSubmitted(name, "owner", second);
      }
      original.call(this, key, text);
    });
  expect(a.clearSubmitted(name, "owner", first)?.text).toBe("");
  spy.mockRestore();
  expect(
    (createSessionTextDraftStorage(vi.fn()).getItem(name) as any).state.drafts
      .owner.text,
  ).toBe("");
  expect(
    Object.keys(localStorage).filter((key) => key.includes(".cleared.")),
  ).toHaveLength(1);
});

it("keeps submitted text if its acknowledgement marker cannot be saved", () => {
  const onError = vi.fn();
  const storage = createSessionTextDraftStorage(onError);
  storage.getItem(name);
  const submitted = { ...draft("keep until saved"), writeId: "a" };
  storage.setItem(name, value({ owner: submitted }));
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(storage.clearSubmitted(name, "owner", submitted)).toBeUndefined();
  expect(onError).toHaveBeenCalledOnce();
  spy.mockRestore();
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ owner: submitted }),
  );
});

it("does not replace an unsaved edit with an older persistent value on acknowledgement", () => {
  const storage = createSessionTextDraftStorage(vi.fn());
  storage.getItem(name);
  storage.setItem(name, value({ owner: draft("old") }));
  const submitted = { ...draft("unsaved edit", 2), writeId: "new" };
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  storage.setItem(name, value({ owner: submitted }));
  spy.mockRestore();
  expect(storage.clearSubmitted(name, "owner", submitted)).toBeUndefined();
});

it("retains one acknowledgement marker per owner and preserves legacy backups", () => {
  const backup = JSON.stringify(value({ owner: draft("legacy") }));
  localStorage.setItem(name, backup);
  const storage = createSessionTextDraftStorage(vi.fn());
  storage.getItem(name);
  expect(storage.clearSubmitted(name, "owner", draft("legacy"))?.text).toBe("");
  expect(
    (createSessionTextDraftStorage(vi.fn()).getItem(name) as any).state.drafts
      .owner.text,
  ).toBe("");
  for (let i = 0; i < 10; i++) {
    const next = { ...draft(`edit ${i}`, i + 2), writeId: `edit-${i}` };
    storage.setItem(name, value({ owner: next }));
    storage.clearSubmitted(name, "owner", next);
  }
  expect(
    Object.keys(localStorage).filter((key) => key.includes(".cleared.")),
  ).toHaveLength(1);
  expect(localStorage.getItem(name)).toBe(backup);
  storage.removeItem(name);
  expect(localStorage.length).toBe(0);
});

it("releases a large submitted payload without deleting another edit's text", () => {
  const storage = createSessionTextDraftStorage(vi.fn());
  storage.getItem(name);
  const submitted = { ...draft("a".repeat(1024 * 1024)), writeId: "large" };
  storage.setItem(name, value({ owner: submitted }));
  storage.clearSubmitted(name, "owner", submitted);
  const bytes = Object.keys(localStorage).reduce(
    (total, key) => total + localStorage.getItem(key)!.length,
    0,
  );
  expect(bytes).toBeLessThan(1024);
  expect(
    (createSessionTextDraftStorage(vi.fn()).getItem(name) as any).state.drafts
      .owner.text,
  ).toBe("");
});

it("moving an already cleared draft does not revive its source", () => {
  const storage = createSessionTextDraftStorage(vi.fn());
  storage.getItem(name);
  const submitted = { ...draft("sent"), writeId: "before-clear" };
  storage.setItem(name, value({ from: submitted }));
  const cleared = storage.clearSubmitted(name, "from", submitted)!;
  storage.setItem(name, value({ to: cleared }));
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ to: cleared }),
  );
});

it("rehydrates the latest pointer if another page replaces a payload while it is being read", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  const old = { ...draft("old"), writeId: "old" };
  const next = { ...draft("new", 2), writeId: "new" };
  a.setItem(name, value({ owner: old }));
  const original = Storage.prototype.getItem;
  let once = false;
  const spy = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(function (this: Storage, key) {
      if (key.includes(".text.owner.old.") && !once) {
        once = true;
        b.setItem(name, value({ owner: next }));
      }
      return original.call(this, key);
    });
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ owner: next }),
  );
  spy.mockRestore();
});

it("does not skip an existing owner when another page removes an earlier payload during enumeration", () => {
  const writer = createSessionTextDraftStorage(vi.fn());
  writer.getItem(name);
  const a = { ...draft("A"), writeId: "a1" };
  const b = { ...draft("B precious"), writeId: "b1" };
  writer.setItem(name, value({ a, b }));
  const original = Storage.prototype.key;
  let changed = false;
  const spy = vi.spyOn(Storage.prototype, "key").mockImplementation(function (
    this: Storage,
    index,
  ) {
    const key = original.call(this, index);
    if (!changed && key?.includes(".text.b.")) {
      changed = true;
      writer.setItem(
        name,
        value({ a: { ...draft("A new", 2), writeId: "a2" }, b }),
      );
    }
    return key;
  });
  const result = createSessionTextDraftStorage(vi.fn()).getItem(name) as any;
  spy.mockRestore();
  expect(result.state.drafts.b).toEqual(b);
});

it("reclaims a concurrently superseded published payload without deleting an unpublished payload", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  a.setItem(name, value({ owner: { ...draft("initial"), writeId: "x" } }));
  const original = Storage.prototype.setItem;
  let raced = false;
  const spy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, text) {
      if (!raced && key === `${name}.entry.owner`) {
        raced = true;
        b.setItem(name, value({ owner: { ...draft("orphan"), writeId: "z" } }));
      }
      original.call(this, key, text);
    });
  a.setItem(name, value({ owner: { ...draft("winner"), writeId: "y" } }));
  spy.mockRestore();
  expect(
    Object.keys(localStorage).filter((key) =>
      key.startsWith(`${name}.text.owner.`),
    ),
  ).toHaveLength(1);
  expect(
    (createSessionTextDraftStorage(vi.fn()).getItem(name) as any).state.drafts
      .owner.text,
  ).toBe("winner");
});

it("retries a captured pointer when the same logical edit is republished at a new payload address", () => {
  const a = createSessionTextDraftStorage(vi.fn());
  const b = createSessionTextDraftStorage(vi.fn());
  a.getItem(name);
  b.getItem(name);
  const shared = { ...draft("same logical edit"), writeId: "same-edit" };
  a.setItem(name, value({ owner: shared }));
  const original = Storage.prototype.getItem;
  let once = false;
  const spy = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(function (this: Storage, key) {
      if (key.includes(".text.owner.same-edit.") && !once) {
        once = true;
        b.setItem(name, value({ owner: shared }));
      }
      return original.call(this, key);
    });
  expect(createSessionTextDraftStorage(vi.fn()).getItem(name)).toEqual(
    value({ owner: shared }),
  );
  spy.mockRestore();
});
