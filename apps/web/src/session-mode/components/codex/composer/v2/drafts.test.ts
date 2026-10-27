import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
let draftModule: typeof import("./drafts");
let storage: typeof import("./draftStorage");
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.resetModules();
  draftModule = await import("./drafts");
  storage = await import("./draftStorage");
});
afterEach(async () => {
  vi.restoreAllMocks();
  const { composerDrafts, useComposerDraftStore } = draftModule;
  await Promise.allSettled(
    Object.keys(useComposerDraftStore.getState().drafts).map((owner) =>
      composerDrafts.flush(owner),
    ),
  );
  draftModule.takeContextDraftHandoff().releaseListener();
  vi.unstubAllGlobals();
});
it("keeps the in-memory context when persistence fails and explicitly retries", async () => {
  const { composerDrafts, useComposerDraftStore } = draftModule;
  const write = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
  composerDrafts.add("a", {
    id: "saved",
    kind: "paste",
    name: "logs",
    text: "do not lose",
  });
  await expect(composerDrafts.flush("a")).rejects.toThrow("quota");
  expect(useComposerDraftStore.getState().error).toContain("未保存");
  expect(composerDrafts.read("a").contexts[0].text).toBe("do not lose");
  write.mockRestore();
  await composerDrafts.retryStorage();
  expect(useComposerDraftStore.getState().error).toBeNull();
  expect(
    (await storage.contextDraftStorage.load("a")).contexts[0].value.text,
  ).toBe("do not lose");
  expect(localStorage.getItem(storage.LEGACY_CONTEXT_KEY)).toBeNull();
});
it("clears only submitted contexts and isolates a later draft in another session", async () => {
  const { composerDrafts } = draftModule;
  composerDrafts.add("a", {
    id: "old",
    kind: "paste",
    name: "日志",
    text: "original",
  });
  const sent = composerDrafts.capture("a");
  composerDrafts.add("a", {
    id: "new",
    kind: "quote",
    name: "引用",
    text: "later",
  });
  composerDrafts.add("b", {
    id: "other",
    kind: "paste",
    name: "其他",
    text: "other session",
  });
  composerDrafts.clearSubmitted("a", sent.contexts, sent.versions);
  expect(composerDrafts.read("a").contexts.map((x) => x.id)).toEqual(["new"]);
  expect(composerDrafts.read("b").contexts[0].text).toBe("other session");
  await Promise.all([composerDrafts.flush("a"), composerDrafts.flush("b")]);
  expect(
    (await storage.contextDraftStorage.load("a")).contexts.map(
      (x) => x.value.id,
    ),
  ).toEqual(["new"]);
  expect(
    (await storage.contextDraftStorage.load("b")).contexts[0].value.text,
  ).toBe("other session");
});
it("moves new-session context and drawing drafts without erasing an existing destination", async () => {
  const { composerDrafts } = draftModule;
  composerDrafts.add("new", {
    id: "source",
    kind: "file",
    name: "f",
    text: "snapshot",
    path: "/f",
  });
  composerDrafts.add("thread", {
    id: "target",
    kind: "paste",
    name: "t",
    text: "existing",
  });
  await composerDrafts.move("new", "thread");
  expect(composerDrafts.read("thread").contexts.map((x) => x.id)).toEqual([
    "target",
    "source",
  ]);
  expect(composerDrafts.read("new").contexts).toHaveLength(0);
  expect(
    (await storage.contextDraftStorage.load("thread")).contexts.map(
      (x) => x.value.id,
    ),
  ).toEqual(["target", "source"]);
  expect((await storage.contextDraftStorage.load("new")).contexts).toHaveLength(
    0,
  );
});
it("undo restores a removed context only to its original owner and position", async () => {
  const { composerDrafts } = draftModule;
  composerDrafts.add("a", {
    id: "one",
    kind: "paste",
    name: "one",
    text: "one",
  });
  composerDrafts.add("a", {
    id: "two",
    kind: "paste",
    name: "two",
    text: "two",
  });
  const undo = composerDrafts.remove("a", "one");
  await undo();
  await undo();
  expect(composerDrafts.read("a").contexts.map((x) => x.id)).toEqual([
    "one",
    "two",
  ]);
  expect(composerDrafts.read("b").contexts).toHaveLength(0);
  expect((await storage.contextDraftStorage.load("a")).contexts).toHaveLength(
    2,
  );
});
