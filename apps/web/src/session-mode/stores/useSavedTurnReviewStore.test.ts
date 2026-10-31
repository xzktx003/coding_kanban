import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useSavedTurnReviewStore } from "./useSavedTurnReviewStore";
import { reviewOwnerKey } from "./useSavedTurnReviewStore";
beforeEach(() => { useSavedTurnReviewStore.setState({ target: null, feedback: {}, reviewScopes: {}, findingItems: {} }); });
afterEach(() => { vi.restoreAllMocks(); });
it("captures immutable review scope and per-item findings without following active sessions", () => {
  const scope = { requestThreadId: "request", reviewThreadId: "review", turnId: "turn", cwd: "/project", target: { type: "baseBranch" as const, branch: "main" } };
  const store = useSavedTurnReviewStore.getState();
  store.captureReviewScope(scope); scope.target.branch = "foreign";
  store.projectFindings({ threadId: "review", turnId: "turn", itemId: "item", cwd: "/project", findings: [{ id: "f", title: "finding", body: "fix", path: "/project/a.ts", start: 2, end: 2, side: "new" }] });
  expect(useSavedTurnReviewStore.getState().reviewScopes[reviewOwnerKey({ threadId: "review", turnId: "turn", cwd: "/project" })].target).toEqual({ type: "baseBranch", branch: "main" });
  expect(useSavedTurnReviewStore.getState().findingItems[reviewOwnerKey({ threadId: "review", turnId: "turn", cwd: "/foreign" })]).toBeUndefined();
  store.projectFindings({ threadId: "review", turnId: "turn", itemId: "item", cwd: "/project", findings: [] });
  expect(useSavedTurnReviewStore.getState().findingItems[reviewOwnerKey({ threadId: "review", turnId: "turn", cwd: "/project" })]).toBeUndefined();
});
it("keeps local review feedback isolated by captured thread, turn and project", () => {
  const first = reviewOwnerKey({ threadId: "a", turnId: "first", cwd: "/a" });
  const other = reviewOwnerKey({ threadId: "b", turnId: "first", cwd: "/b" });
  const selection = { side: "old" as const, start: 80, end: 82, content: "saved old lines" };
  const store = useSavedTurnReviewStore.getState();
  store.setCommentDraft(first, "a.ts", selection, "Keep the old contract");
  store.saveComment(first, "a.ts", selection);
  expect(useSavedTurnReviewStore.getState().feedback[first].comments).toMatchObject([{ path: "a.ts", selection, body: "Keep the old contract" }]);
  expect(useSavedTurnReviewStore.getState().feedback[other]).toBeUndefined();
  expect(localStorage.getItem("kanban.session.review-comments")).toContain("Keep the old contract");
  store.close();
  expect(useSavedTurnReviewStore.getState().feedback[first].comments).toHaveLength(1);
});
it("saved review captures owner and immutable patch and never follows another project's selection", () => {
  const changes = [
    {
      path: "file.py",
      diff: "@@ -115 +115 @@\n-old\n+saved\n",
      kind: { type: "update" as const, move_path: null },
      addedCount: 1,
      removedCount: 1,
    },
  ];
  useSavedTurnReviewStore
    .getState()
    .open(
      { threadId: "a", turnId: "first", cwd: "/a", changes, batches: [] },
      "file.py",
    );
  changes[0].diff = "mutated";
  expect(useSavedTurnReviewStore.getState().target).toMatchObject({
    threadId: "a",
    turnId: "first",
    cwd: "/a",
    selectedPath: "file.py",
    changes: [{ diff: "@@ -115 +115 @@\n-old\n+saved\n" }],
  });
  useSavedTurnReviewStore.getState().close();
  expect(useSavedTurnReviewStore.getState().target).toBeNull();
});

it("does not retain or persist empty projections from ordinary completed messages", () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  const before = useSavedTurnReviewStore.getState();
  for (let index = 0; index < 1000; index++) {
    before.projectFindings({ threadId: "plain", turnId: `turn-${index}`, itemId: `item-${index}`, findings: [] });
  }
  expect(useSavedTurnReviewStore.getState()).toBe(before);
  expect(useSavedTurnReviewStore.getState().findingItems).toEqual({});
  expect(write).not.toHaveBeenCalled();
});
it("does not persist identical findings on virtualized remount", () => {
  const projection = { threadId: "owner", turnId: "turn", itemId: "item", findings: [{ id: "finding", title: "title", body: "body", path: "/project/a.ts", start: 1, end: 1, side: "new" as const }] };
  useSavedTurnReviewStore.getState().projectFindings(projection);
  const before = useSavedTurnReviewStore.getState();
  const write = vi.spyOn(Storage.prototype, "setItem");
  for (let index = 0; index < 100; index++) before.projectFindings(structuredClone(projection));
  expect(useSavedTurnReviewStore.getState()).toBe(before);
  expect(write).not.toHaveBeenCalled();
});
it("clears obsolete findings without deleting sibling items, feedback or captured review scope", () => {
  const owner = { threadId: "owner", turnId: "turn", cwd: "/project" };
  const key = reviewOwnerKey(owner);
  const finding = { id: "finding", title: "title", body: "body", path: "/project/a.ts", start: 1, end: 1, side: "new" as const };
  const store = useSavedTurnReviewStore.getState();
  store.projectFindings({ ...owner, itemId: "first", findings: [finding] });
  store.projectFindings({ ...owner, itemId: "second", findings: [finding] });
  store.setCommentDraft(key, "a.ts", { side: "new", start: 1, end: 1, content: "line" }, "keep comment");
  store.captureReviewScope({ requestThreadId: "request", reviewThreadId: "owner", turnId: "turn", cwd: "/project", target: { type: "baseBranch", branch: "main" } });
  store.projectFindings({ ...owner, itemId: "first", findings: [] });
  expect(useSavedTurnReviewStore.getState().findingItems[key]).toEqual({ second: [finding] });
  store.projectFindings({ ...owner, itemId: "second", findings: [] });
  expect(useSavedTurnReviewStore.getState().findingItems[key]).toBeUndefined();
  expect(useSavedTurnReviewStore.getState().feedback[key]).toBeDefined();
  expect(useSavedTurnReviewStore.getState().reviewScopes[key]).toBeDefined();
});

it("removes a legacy persisted empty projection once without repeating writes", () => {
  const owner = { threadId: "legacy", turnId: "turn" };
  const key = reviewOwnerKey(owner);
  useSavedTurnReviewStore.setState({ findingItems: { [key]: { item: [] } } });
  const write = vi.spyOn(Storage.prototype, "setItem");
  const store = useSavedTurnReviewStore.getState();
  store.projectFindings({ ...owner, itemId: "item", findings: [] });
  expect(useSavedTurnReviewStore.getState().findingItems[key]).toBeUndefined();
  expect(write).toHaveBeenCalledTimes(1);
  store.projectFindings({ ...owner, itemId: "item", findings: [] });
  expect(write).toHaveBeenCalledTimes(1);
});
it("compacts legacy empty projections once during hydration without writing or discarding review data", async () => {
  const findings = [{ id: "finding", title: "title", body: "body", path: "/project/a.ts", start: 1, end: 1, side: "new" as const }];
  const findingItems: Record<string, unknown> = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`legacy-${index}`, { item: [] }]));
  findingItems.kept = { empty: [], finding: findings };
  // Only recognized empty arrays can be discarded, not unknown future shapes.
  findingItems.unknown = { opaque: { version: 2 }, unavailable: null };
  findingItems.invalidOwner = null;
  const feedback = { kept: { drafts: { draft: "keep unsent text" }, comments: [{ id: "comment", path: "a.ts", selection: { side: "new", start: 1, end: 1, content: "line" }, body: "keep comment" }] } };
  const reviewScopes = { kept: { requestThreadId: "request", reviewThreadId: "review", turnId: "turn", cwd: "/project", target: { type: "baseBranch", branch: "main" } } };
  const persisted = { findingItems, feedback, reviewScopes };
  localStorage.setItem("kanban.session.review-comments", JSON.stringify({ version: 1, state: persisted }));
  const write = vi.spyOn(Storage.prototype, "setItem");
  await useSavedTurnReviewStore.persist.rehydrate();
  expect(useSavedTurnReviewStore.getState().findingItems).toEqual({ kept: { finding: findings }, unknown: findingItems.unknown, invalidOwner: null });
  expect(useSavedTurnReviewStore.getState().feedback).toEqual(feedback);
  expect(useSavedTurnReviewStore.getState().reviewScopes).toEqual(reviewScopes);
  expect(write).not.toHaveBeenCalled();
  // The stored source is untouched until a normal, real review mutation.
  expect(JSON.parse(localStorage.getItem("kanban.session.review-comments")!).state).toEqual(persisted);
  useSavedTurnReviewStore.getState().projectFindings({ threadId: "new", turnId: "turn", itemId: "item", findings });
  expect(write).toHaveBeenCalledTimes(1);
  const compacted = JSON.parse(localStorage.getItem("kanban.session.review-comments")!).state;
  expect(Object.keys(compacted.findingItems)).toHaveLength(4);
  expect(compacted.findingItems["legacy-999"]).toBeUndefined();
  expect(compacted.feedback).toEqual(feedback);
});
