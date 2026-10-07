import { beforeEach, expect, it } from "vitest";
import { useFileDocumentStore } from "./useFileDocumentStore";
beforeEach(() => {
  localStorage.clear();
  useFileDocumentStore.setState({ documents: {} });
});
it("restores dirty drafts without replacing them with disk content on refresh", async () => {
  const s = useFileDocumentStore.getState();
  s.load("/p/a", "/p", "before", "v1");
  s.edit("/p/a", "draft");
  const saved = localStorage.getItem("kanban.session.file-drafts")!;
  useFileDocumentStore.setState({ documents: {} });
  localStorage.setItem("kanban.session.file-drafts", saved);
  await useFileDocumentStore.persist.rehydrate();
  s.load("/p/a", "/p", "agent changed", "v2");
  expect(useFileDocumentStore.getState().documents["/p/a"]).toMatchObject({
    draft: "draft",
    base: "before",
    version: "v1",
    diskChanged: true,
  });
});
it("save acknowledgement does not discard typing that happened while saving", () => {
  const s = useFileDocumentStore.getState();
  s.load("/p/a", "/p", "before", "v1");
  s.edit("/p/a", "submitted");
  s.edit("/p/a", "submitted plus new text");
  s.saved("/p/a", "submitted", "v2");
  expect(useFileDocumentStore.getState().documents["/p/a"]).toMatchObject({
    base: "submitted",
    draft: "submitted plus new text",
    version: "v2",
  });
});
it("renaming a directory relocates descendant drafts and discard explicitly returns to the saved content", () => {
  const s = useFileDocumentStore.getState();
  s.load("/p/f/a", "/p", "original", "v1");
  s.edit("/p/f/a", "draft");
  s.move("/p/f", "/p/renamed");
  expect(useFileDocumentStore.getState().documents["/p/f/a"]).toBeUndefined();
  expect(useFileDocumentStore.getState().documents["/p/renamed/a"].draft).toBe(
    "draft",
  );
  s.discard("/p/renamed/a");
  expect(useFileDocumentStore.getState().documents["/p/renamed/a"].draft).toBe(
    "original",
  );
});
