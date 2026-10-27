import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createThreadModelController,
  type ThreadModelEntry,
} from "./useThreadModelStore";
import { ThreadModelPersistenceError } from "./threadModelPersistence";

let indexedDB: IDBFactory;
let clients: ReturnType<typeof createThreadModelController>[];
beforeEach(() => {
  indexedDB = new IDBFactory();
  clients = [];
});
afterEach(async () => {
  await Promise.all(clients.map((c) => c.persistence.close()));
});
function client(legacy: () => Record<string, ThreadModelEntry> = () => ({})) {
  const c = createThreadModelController({
    indexedDB,
    databaseName: "settings-test",
    legacy,
    connectEvents: false,
  });
  clients.push(c);
  return c;
}
it("attaches cross-tab refresh listeners only during its explicit lifecycle", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const c = createThreadModelController({
    indexedDB,
    databaseName: "settings-event-lifecycle-test",
  });
  clients.push(c);
  expect(add).not.toHaveBeenCalledWith("focus", expect.any(Function));
  c.persistence.resume();
  expect(add).toHaveBeenCalledWith("focus", expect.any(Function));
  c.persistence.suspend();
  expect(remove).toHaveBeenCalledWith("focus", expect.any(Function));
});
async function seed(c: ReturnType<typeof client>, id = "a") {
  await c.persistence.ensure(id);
  c.hydrate(id, {
    model: "native",
    reasoningEffort: "medium",
    serviceTier: null,
  });
  await c.flush(id);
}
const row = (c: ReturnType<typeof client>, id = "a") =>
  c.store.getState().threads[id];

it.each(["before-commit", "after-commit"])(
  "dismisses the captured notice identity despite a merged revision (%s)",
  async (timing) => {
    const a = client(), b = client();
    await seed(a);
    await b.persistence.ensure("a");
    b.change("a", { serviceTier: "fast" });
    await b.flush("a");
    a.change("a", { model: "chosen" });
    const captured = { ...row(a).notice! };
    if (timing === "after-commit") {
      await a.flush("a");
      expect(row(a).notice!.id).not.toBe(captured.id);
      expect(row(a).notice!.identity).toBe(captured.identity);
    }
    a.dismiss("a", captured.id, captured.identity);
    await a.flush("a");
    const restored = client();
    await restored.persistence.ensure("a");
    expect(row(restored)).toMatchObject({
      model: "chosen", serviceTier: "fast",
      notice: { identity: captured.identity, dismissed: true },
    });
  },
);

it("keeps the numeric fence for legacy dismissal and rejects a mismatched exact identity", async () => {
  const a = client(), b = client();
  await seed(a);
  await b.persistence.ensure("a");
  b.change("a", { serviceTier: "fast" });
  await b.flush("a");
  a.change("a", { model: "chosen" });
  const captured = { ...row(a).notice! };
  await a.flush("a");
  a.dismiss("a", captured.id);
  a.dismiss("a", row(a).notice!.id, "different-notice");
  await a.flush("a");
  expect(row(a).notice?.dismissed).toBe(false);
  a.dismiss("a", row(a).notice!.id);
  await a.flush("a");
  expect(row(a).notice?.dismissed).toBe(true);
});

it.each(["edit", "observe"])(
  "another page's %s of B cannot overwrite the unsent settings of A",
  async (kind) => {
    const a = client(),
      b = client();
    await seed(a);
    await seed(a, "b");
    await b.persistence.ensure("a");
    await b.persistence.ensure("b");
    a.change("a", { model: "chosen-a", reasoningEffort: "high" });
    await a.flush("a");
    if (kind === "edit") b.change("b", { model: "chosen-b" });
    else b.hydrate("b", { model: "native-b" });
    await b.flush("b");
    const refreshed = client();
    await refreshed.persistence.ensure("a");
    expect(row(refreshed)).toMatchObject({
      model: "chosen-a",
      reasoningEffort: "high",
      pending: true,
    });
  },
);
it("serializes independent settings groups on the same thread and unions pending fields", async () => {
  const a = client(),
    b = client();
  await seed(a);
  await b.persistence.ensure("a");
  a.change("a", { reasoningEffort: "high" });
  b.change("a", { serviceTier: "fast" });
  await Promise.all([a.flush("a"), b.flush("a")]);
  await a.persistence.ensure("a", true);
  expect(row(a)).toMatchObject({
    reasoningEffort: "high",
    serviceTier: "fast",
    pending: true,
  });
  expect(row(a).pendingFields).toEqual(
    expect.arrayContaining(["reasoningEffort", "serviceTier"]),
  );
});
it("same-group conflicts retain the second page's local choice until explicit retry", async () => {
  const a = client(),
    b = client();
  await seed(a);
  await b.persistence.ensure("a");
  a.change("a", { model: "first" });
  await a.flush("a");
  b.change("a", { model: "second" });
  await expect(b.flush("a")).rejects.toMatchObject({ kind: "conflict" });
  expect(row(b).model).toBe("second");
  expect(b.store.getState().storage?.a.status).toBe("conflict");
  const read = client();
  await read.persistence.ensure("a");
  expect(row(read).model).toBe("first");
  await b.persistence.retry("a");
  await read.persistence.ensure("a", true);
  expect(row(read).model).toBe("second");
});
it.each(["observe", "ack"])(
  "old matching %s cannot clear an ABA edit from another page",
  async (kind) => {
    const a = client(),
      b = client();
    await seed(a);
    await b.persistence.ensure("a");
    const readToken = b.persistence.token("a");
    a.change("a", { model: "intermediate" });
    await a.flush("a");
    a.change("a", { model: "native" });
    await a.flush("a");
    b.hydrate(
      "a",
      { model: "native", reasoningEffort: "medium" },
      { readToken },
      kind as "observe" | "ack",
    );
    await b.flush("a");
    expect(row(b)).toMatchObject({ model: "native", pending: true });
    expect(row(b).pendingFields).toContain("model");
  },
);
it("initialOnly never acknowledges a pending choice or replaces accepted native settings", async () => {
  const a = client(),
    b = client();
  await seed(a);
  await b.persistence.ensure("a");
  const readToken = b.persistence.token("a");
  a.change("a", { serviceTier: "fast" });
  await a.flush("a");
  b.hydrate(
    "a",
    { model: "older", serviceTier: null },
    { readToken, initialOnly: true },
  );
  await b.flush("a");
  expect(row(b)).toMatchObject({
    model: "native",
    serviceTier: "fast",
    pending: true,
  });
});
it("a read begun before asynchronous cold hydration is not rebased over an existing edit", async () => {
  const a = client();
  await seed(a);
  a.change("a", { model: "chosen" });
  await a.flush("a");
  const cold = client(),
    readToken = cold.persistence.token("a");
  cold.hydrate("a", { model: "old-snapshot" }, { readToken });
  await cold.flush("a");
  expect(row(cold)).toMatchObject({ model: "chosen", pending: true });
});
it("native permission metadata stays local and never becomes a restored permission source", async () => {
  const a = client();
  await seed(a);
  const metadata = {
    activePermissionProfile: {
      kind: "value",
      value: { id: "private-profile", extends: null },
    },
  } as NonNullable<ThreadModelEntry["nativePermissionMetadata"]>;
  a.hydrate("a", { model: "native", nativePermissionMetadata: metadata });
  await a.flush("a");
  const b = client();
  await b.persistence.ensure("a");
  expect(row(b).nativePermissionMetadata).toBeUndefined();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("settings-test", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const all = await new Promise<unknown[]>((resolve, reject) => {
    const tx = database.transaction("threads");
    const r = tx.objectStore("threads").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  database.close();
  expect(JSON.stringify(all)).not.toContain("nativePermissionMetadata");
  expect(JSON.stringify(all)).not.toContain("private-profile");
});
it("rejects old runtime observations and captured sends, preserving local pending preferences", async () => {
  const a = client();
  await seed(a);
  const readToken = a.persistence.token("a"),
    capture = a.capture("a");
  a.setScope("1");
  a.hydrate("a", { model: "wrong-runtime" }, { readToken });
  await a.flush("a");
  expect(row(a).model).toBe("native");
  expect(() => a.assertCurrent(capture)).toThrow(ThreadModelPersistenceError);
  a.change("a", { model: "chosen" });
  await a.flush("a");
  expect(row(a).pending).toBe(true);
});
it("captures an immutable configuration and preserves its saved prefix when later selections change", async () => {
  const a = client();
  await seed(a);
  a.change("a", { model: "first" });
  const capture = a.capture("a");
  await a.flush("a", capture);
  expect(Object.isFrozen(capture.settings)).toBe(true);
  expect(Object.isFrozen(capture.settings.providerModels)).toBe(true);
  a.change("a", { model: "second" });
  await a.flush("a", capture);
  a.assertCurrent(capture);
  await a.flush("a");
  expect(capture.settings.model).toBe("first");
});
it("uses an exact notice identity for dismissal across independent numeric revisions", async () => {
  const a = client(),
    b = client();
  await seed(a);
  await b.persistence.ensure("a");
  a.change("a", { model: "first" });
  await a.flush("a");
  const old = row(a).notice!;
  await b.persistence.ensure("a", true);
  b.change("a", { model: "second" });
  await b.flush("a");
  a.dismiss("a", old.id, old.identity);
  await a.flush("a");
  expect(row(a).notice).toMatchObject({ to: "second", dismissed: false });
});
it("imports a legacy backup once, strips volatile metadata, and ignores later old-page rewrites", async () => {
  let model = "legacy";
  const legacy = () => ({
    a: {
      model,
      revision: 2,
      pending: true,
      nativePermissionMetadata: { permissionProfileId: "never-persist" },
    } as unknown as ThreadModelEntry,
  });
  const a = client(legacy);
  await a.persistence.ensure("a");
  expect(row(a).model).toBe("legacy");
  expect(row(a).nativePermissionMetadata).toBeUndefined();
  a.change("a", { model: "new" });
  await a.flush("a");
  model = "rewritten-old-page";
  const b = client(legacy);
  await b.persistence.ensure("a");
  expect(row(b).model).toBe("new");
});
it("does not notify or enqueue writes for the same native snapshot", async () => {
  const a = client();
  await seed(a);
  const observe = vi.fn();
  const off = a.store.subscribe(observe);
  a.hydrate("a", {
    model: "native",
    reasoningEffort: "medium",
    serviceTier: null,
  });
  expect(observe).not.toHaveBeenCalled();
  off();
});
it("storage failure is explicit and retains the local selection for retry", async () => {
  const a = client(() => {
    throw new Error("Malformed backup");
  });
  a.change("a", { model: "not-lost" });
  await expect(a.flush("a")).rejects.toThrow("Malformed backup");
  expect(row(a).model).toBe("not-lost");
  expect(a.store.getState().storage?.a.status).toBe("error");
});
it("captures the complete sandbox policy without sharing its mutable object", async () => {
  const a = client();
  await seed(a);
  a.hydrate("a", {
    model: "native",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["/fixture"],
      networkAccess: true,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    },
  });
  await a.flush("a");
  const capture = a.capture("a");
  expect(capture.settings.sandboxPolicy).toEqual(row(a).sandboxPolicy);
  expect(capture.settings.sandboxPolicy).not.toBe(row(a).sandboxPolicy);
  expect(Object.isFrozen(capture.settings.sandboxPolicy)).toBe(true);
});
it("rejects a locally stale read before any optimistic acknowledgement becomes visible", async () => {
  const a = client();
  await seed(a);
  const readToken = a.persistence.token("a");
  a.change("a", { model: "away" });
  a.change("a", { model: "native" });
  const pending = row(a);
  a.hydrate("a", { model: "native", reasoningEffort: "medium" }, { readToken });
  expect(row(a)).toBe(pending);
  expect(row(a).pending).toBe(true);
  await a.flush("a");
  expect(row(a).pending).toBe(true);
});
it("failed storage retains a bounded unsaved queue and rejects overflow visibly", async () => {
  const a = client(() => {
    throw new Error("storage unavailable");
  });
  for (let i = 0; i < 200; i++) a.change("a", { model: `choice-${i}` });
  expect(a.persistence.handoff.queues.get("a")?.length).toBe(64);
  expect(row(a).model).toBe("choice-63");
  await expect(a.flush("a")).rejects.toBeInstanceOf(
    ThreadModelPersistenceError,
  );
});
it("times out opening storage, closes a late success, and permits explicit retry", async () => {
  let request: Partial<IDBOpenDBRequest> = {};
  const open = vi.fn<(name: string, version?: number) => IDBOpenDBRequest>(
    () => request as IDBOpenDBRequest,
  );
  const a = createThreadModelController({
    indexedDB: { open } as unknown as IDBFactory,
    databaseName: "timeout",
    legacy: () => ({}),
    connectEvents: false,
    timeoutMs: 5,
  });
  clients.push(a);
  a.change("a", { model: "saved-after-retry" });
  await expect(a.flush("a")).rejects.toThrow("超时");
  const close = vi.fn();
  Object.assign(request, { result: { close } });
  request.onsuccess?.call(request as IDBOpenDBRequest, new Event("success"));
  expect(close).toHaveBeenCalledOnce();
  open.mockImplementation((name, version) => indexedDB.open(name, version));
  await a.persistence.retry("a");
  await a.flush("a");
  expect(row(a).model).toBe("saved-after-retry");
});
it("hands an in-flight queue and captured identities to fresh controller methods", async () => {
  const a = client();
  await seed(a);
  a.change("a", { model: "handoff" });
  const capture = a.capture("a");
  a.persistence.suspend();
  const next = createThreadModelController(
    {
      indexedDB,
      databaseName: "settings-test",
      legacy: () => ({}),
      connectEvents: false,
    },
    a,
  );
  clients.push(next);
  expect(next.change).not.toBe(a.change);
  expect(next.store).toBe(a.store);
  expect(next.persistence.handoff).toBe(a.persistence.handoff);
  await next.flush("a", capture);
  expect(row(next).model).toBe("handoff");
  next.change("a", { serviceTier: "fast" });
  await next.flush("a");
  const reloaded = client();
  await reloaded.persistence.ensure("a");
  expect(row(reloaded)).toMatchObject({
    model: "handoff",
    serviceTier: "fast",
    pending: true,
  });
});
it("preserves the exact earlier pending selection when a later edit is queued before its save finishes", async () => {
  const a = client();
  await seed(a);
  a.change("a", { model: "first", reasoningEffort: "high" });
  const capture = a.capture("a");
  a.change("a", { model: "second", reasoningEffort: "low" });
  await a.flush("a", capture);
  a.assertCurrent(capture);
  expect(capture.settings).toMatchObject({
    model: "first",
    reasoningEffort: "high",
  });
  await a.flush("a");
  expect(row(a).model).toBe("second");
});
it("allows unknown native defaults only after proving disk has no hidden saved selection", async () => {
  const empty = client();
  const nativeDefaults = empty.capture("unknown");
  await empty.flush("unknown", nativeDefaults);
  expect(nativeDefaults.settings.model).toBe("");
  const writer = client();
  await seed(writer);
  writer.change("a", { model: "saved" });
  await writer.flush("a");
  const cold = client(),
    capture = cold.capture("a");
  await expect(cold.flush("a", capture)).rejects.toThrow("恢复");
  expect(row(cold).model).toBe("saved");
});
it("works without crypto.randomUUID on an HTTP LAN origin", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: undefined,
  });
  try {
    const a = client();
    await seed(a);
    a.change("a", { model: "http-compatible" });
    await a.flush("a");
    expect(row(a).model).toBe("http-compatible");
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis.crypto, "randomUUID", descriptor);
    else delete (globalThis.crypto as Partial<Crypto>).randomUUID;
  }
});
it("same-valued explicit fields cannot overwrite a remote edit in a different group", async () => {
  const a = client(),
    b = client();
  await seed(a);
  await b.persistence.ensure("a");
  a.change("a", { serviceTier: "fast" });
  await a.flush("a");
  b.change("a", { model: "new-model", serviceTier: null });
  await b.flush("a");
  expect(row(b)).toMatchObject({
    model: "new-model",
    serviceTier: "fast",
    pending: true,
  });
});
it("a retry renews only pending completion promises; old failed captures stay failed", async () => {
  let fail = true;
  const a = client(() => {
    if (fail) throw Error("quota");
    return {};
  });
  a.change("a", { model: "preserved" });
  const oldCapture = a.capture("a");
  await expect(a.flush("a", oldCapture)).rejects.toThrow("quota");
  fail = false;
  const retry = a.persistence.retry("a");
  const newCapture = a.capture("a");
  await retry;
  await a.flush("a", newCapture);
  await expect(a.flush("a", oldCapture)).rejects.toThrow("quota");
  expect(newCapture.settings.model).toBe("preserved");
});
async function holdWriteTransaction() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("settings-test", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = db.transaction("threads", "readwrite");
  let released = false;
  const loop = () => {
    const r = tx.objectStore("threads").get("a");
    r.onsuccess = () => {
      if (!released) loop();
    };
  };
  loop();
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  return async () => {
    released = true;
    await completed;
    db.close();
  };
}
it("aborts a blocked save at its deadline and preserves the local intent for explicit retry", async () => {
  const a = createThreadModelController({
    indexedDB,
    databaseName: "settings-test",
    legacy: () => ({}),
    connectEvents: false,
    timeoutMs: 20,
  });
  clients.push(a);
  await seed(a);
  const release = await holdWriteTransaction();
  try {
    a.change("a", { model: "blocked" });
    await expect(a.flush("a")).rejects.toThrow("超时");
    expect(row(a).model).toBe("blocked");
  } finally {
    await release();
  }
  await a.persistence.retry("a");
  await a.flush("a");
  expect(row(a).model).toBe("blocked");
});
it("scope changes while a native transaction is waiting abort that old observation", async () => {
  const a = client();
  await seed(a);
  const readToken = a.persistence.token("a"),
    release = await holdWriteTransaction();
  a.hydrate("a", { model: "old-runtime" }, { readToken });
  await vi.waitFor(() =>
    expect(a.persistence.handoff.nativeTransactions.size).toBe(1),
  );
  a.setScope("next");
  await release();
  await a.flush("a");
  expect(row(a).model).toBe("native");
});
it("snapshots initialOnly and notify intent options before its asynchronous transaction", async () => {
  const a = client();
  await seed(a);
  const options = { initialOnly: true, notify: true };
  a.hydrate("a", { model: "older", personality: "friendly" }, options);
  options.initialOnly = false;
  options.notify = false;
  await a.flush("a");
  expect(row(a).model).toBe("native");
  expect(row(a).personality).toBe("friendly");
  expect(row(a).notice).toBeUndefined();
});
