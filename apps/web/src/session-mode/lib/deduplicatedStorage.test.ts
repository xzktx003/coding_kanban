import { beforeEach, expect, it, vi } from "vitest";
import { createDeduplicatedJSONStorage } from "./deduplicatedStorage";

beforeEach(() => localStorage.clear());

it("skips equal snapshots while persisting a real value change", () => {
  const storage = createDeduplicatedJSONStorage<{ name: string }>()!;
  const writes = vi.spyOn(Storage.prototype, "setItem");
  try {
    storage.setItem("test", { state: { name: "first" }, version: 1 });
    storage.setItem("test", { state: { name: "first" }, version: 1 });
    expect(writes).toHaveBeenCalledTimes(1);
    storage.setItem("test", { state: { name: "renamed" }, version: 1 });
    expect(writes).toHaveBeenCalledTimes(2);
    expect(storage.getItem("test")).toEqual({
      state: { name: "renamed" },
      version: 1,
    });
  } finally {
    writes.mockRestore();
  }
});

it("rechecks shared storage after another page changes or clears its value", () => {
  const storage = createDeduplicatedJSONStorage<{ name: string }>()!;
  const snapshot = { state: { name: "local" }, version: 1 };
  storage.setItem("test", snapshot);
  localStorage.setItem(
    "test",
    JSON.stringify({ state: { name: "other page" }, version: 1 }),
  );
  storage.setItem("test", snapshot);
  expect(storage.getItem("test")).toEqual(snapshot);
  localStorage.removeItem("test");
  storage.setItem("test", snapshot);
  expect(storage.getItem("test")).toEqual(snapshot);
  storage.removeItem("test");
  expect(storage.getItem("test")).toBeNull();
});

it("propagates storage failures rather than reporting a successful save", () => {
  const storage = createDeduplicatedJSONStorage<{ name: string }>()!;
  const failure = new Error("storage unavailable");
  const writes = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw failure;
    });
  try {
    expect(() => storage.setItem("test", { state: { name: "local" } })).toThrow(
      failure,
    );
  } finally {
    writes.mockRestore();
  }
});
