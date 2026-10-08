import { expect, it, vi } from "vitest";
it("recovering unread storage merges existing context with memory-only edits", async () => {
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
  composerDrafts.retryStorage();
  expect(useComposerDraftStore.getState().error).toBeNull();
  expect(composerDrafts.read("a").contexts.map((c) => c.id)).toEqual([
    "old",
    "new",
  ]);
});
