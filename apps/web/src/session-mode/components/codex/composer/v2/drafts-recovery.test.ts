import { expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
it("recovering unread storage merges existing context with memory-only edits", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("kanban.session.composer-v2", "invalid-json");
  vi.resetModules();
  const { composerDrafts, useComposerDraftStore } = await import("./drafts");
  composerDrafts.add("a", {
    id: "new",
    kind: "paste",
    name: "new",
    text: "new content",
  });
  expect(localStorage.getItem("kanban.session.composer-v2")).toBe(
    "invalid-json",
  );
  await expect(composerDrafts.flush("a")).rejects.toThrow();
  expect(useComposerDraftStore.getState().error).toContain("未保存");
  expect(localStorage.getItem("kanban.session.composer-v2")).toBe(
    "invalid-json",
  );
  localStorage.setItem(
    "kanban.session.composer-v2",
    JSON.stringify({
      a: {
        contexts: [
          { id: "old", kind: "paste", name: "old", text: "old content" },
        ],
        drawings: {},
        expanded: false,
        plain: false,
      },
    }),
  );
  await composerDrafts.retryStorage();
  expect(useComposerDraftStore.getState().error).toBeNull();
  const { contextDraftStorage } = await import("./draftStorage");
  expect(
    (await contextDraftStorage.load("a")).contexts.map((c) => c.value.id),
  ).toEqual(["old", "new"]);
  expect(composerDrafts.read("a").contexts.map((c) => c.id)).toEqual([
    "old",
    "new",
  ]);
  (await import("./drafts")).takeContextDraftHandoff().releaseListener();
  vi.unstubAllGlobals();
});
