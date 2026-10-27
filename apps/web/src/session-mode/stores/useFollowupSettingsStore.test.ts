import { afterEach, beforeEach, expect, it, vi } from "vitest";
const legacy = "kanban.session.followup-settings";
const key = (field: string) => `${legacy}.v1.${field}`;
let listeners: Array<[string, EventListenerOrEventListenerObject]>;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type, listener, options) => {
      if (type === "storage" || type === "focus")
        listeners.push([type, listener]);
      add(type, listener, options);
    },
  );
});
afterEach(() => {
  for (const [type, listener] of listeners)
    window.removeEventListener(type, listener);
  vi.restoreAllMocks();
});
const load = async () =>
  (await import("./useFollowupSettingsStore")).useFollowupSettingsStore;
it("independent stale stores write only their changed field", async () => {
  const a = await load();
  vi.resetModules();
  const b = await load();
  const writes = vi.spyOn(Storage.prototype, "setItem");
  a.getState().setMode("steer");
  b.getState().setEnterBehavior("cmdAlways");
  b.getState().setReviewDelivery("detached");
  expect(writes.mock.calls.map(([k]) => k)).toEqual([
    key("mode"),
    key("enterBehavior"),
    key("reviewDelivery"),
  ]);
  vi.resetModules();
  expect((await load()).getState()).toMatchObject({
    mode: "steer",
    enterBehavior: "cmdAlways",
    reviewDelivery: "detached",
  });
});
it("reads valid legacy fields without writing or changing its backup", async () => {
  const backup = JSON.stringify({
    state: {
      mode: "steer",
      enterBehavior: "cmdIfMultiline",
      reviewDelivery: "detached",
    },
    version: 0,
  });
  localStorage.setItem(legacy, backup);
  localStorage.setItem(key("mode"), '"queue"');
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const store = await load();
  expect(store.getState()).toMatchObject({
    mode: "queue",
    enterBehavior: "cmdIfMultiline",
    reviewDelivery: "detached",
    persistenceError: null,
  });
  store.getState().setMode("steer");
  expect(writes.mock.calls.map(([k]) => k)).toEqual([key("mode")]);
  expect(localStorage.getItem(legacy)).toBe(backup);
});
it("late storage events read current values and unchanged refresh does not notify or write", async () => {
  const store = await load();
  const notify = vi.fn();
  store.subscribe(notify);
  localStorage.setItem(key("mode"), '"steer"');
  const writes = vi.spyOn(Storage.prototype, "setItem");
  window.dispatchEvent(
    new StorageEvent("storage", { key: key("mode"), newValue: '"queue"' }),
  );
  expect(store.getState().mode).toBe("steer");
  expect(notify).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("focus"));
  expect(notify).toHaveBeenCalledOnce();
  expect(writes).not.toHaveBeenCalled();
});
it("quota failure retains only the unsaved local field and an unchanged setter retries", async () => {
  const store = await load();
  const original = Storage.prototype.setItem;
  const writes = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, k, v) {
      if (k === key("mode"))
        throw new DOMException("fixture quota", "QuotaExceededError");
      original.call(this, k, v);
    });
  store.getState().setMode("steer");
  expect(store.getState()).toMatchObject({
    mode: "steer",
    persistenceError: expect.stringContaining("fixture quota"),
  });
  original.call(localStorage, key("mode"), '"queue"');
  original.call(localStorage, key("enterBehavior"), '"cmdAlways"');
  window.dispatchEvent(
    new StorageEvent("storage", { key: key("enterBehavior") }),
  );
  expect(store.getState()).toMatchObject({
    mode: "steer",
    enterBehavior: "cmdAlways",
  });
  writes.mockRestore();
  store.getState().setMode("steer");
  expect(store.getState().persistenceError).toBeNull();
  expect(localStorage.getItem(key("mode"))).toBe('"steer"');
});
it("explicit retry saves failed choices without overwriting other-page preferences", async () => {
  const store = await load();
  const writes = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("write denied");
    });
  store.getState().setReviewDelivery("detached");
  writes.mockRestore();
  localStorage.setItem(key("mode"), '"steer"');
  store.getState().retryPersistence();
  expect(store.getState()).toMatchObject({
    mode: "steer",
    reviewDelivery: "detached",
    persistenceError: null,
  });
});
it("malformed field data is preserved and reports failure without erasing the working choice", async () => {
  const store = await load();
  store.getState().setMode("steer");
  localStorage.setItem(key("mode"), "{broken");
  window.dispatchEvent(new Event("focus"));
  expect(store.getState()).toMatchObject({
    mode: "steer",
    persistenceError: expect.stringContaining("偏好读取失败"),
  });
  expect(localStorage.getItem(key("mode"))).toBe("{broken");
  store.getState().setMode("queue");
  expect(store.getState().persistenceError).toBeNull();
});
it("unavailable reads keep safe defaults and explicit retry recovers without a write", async () => {
  localStorage.setItem(key("mode"), '"steer"');
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("read denied");
  });
  const store = await load();
  expect(store.getState()).toMatchObject({
    mode: "queue",
    enterBehavior: "enter",
    reviewDelivery: "inline",
    persistenceError: expect.stringContaining("read denied"),
  });
  get.mockRestore();
  const writes = vi.spyOn(Storage.prototype, "setItem");
  store.getState().retryPersistence();
  expect(store.getState()).toMatchObject({
    mode: "steer",
    persistenceError: null,
  });
  expect(writes).not.toHaveBeenCalled();
});
it("keeps malformed legacy backup untouched while exposing defaults and a recovery error", async () => {
  localStorage.setItem(legacy, '{"unexpected":true}');
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const store = await load();
  expect(store.getState()).toMatchObject({
    mode: "queue",
    enterBehavior: "enter",
    reviewDelivery: "inline",
    persistenceError: expect.stringContaining("旧偏好格式无效"),
  });
  expect(localStorage.getItem(legacy)).toBe('{"unexpected":true}');
  expect(writes).not.toHaveBeenCalled();
});
