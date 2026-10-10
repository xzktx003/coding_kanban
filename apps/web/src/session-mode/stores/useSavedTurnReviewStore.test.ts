import { expect, it } from "vitest";
import { useSavedTurnReviewStore } from "./useSavedTurnReviewStore";
import { reviewOwnerKey } from "./useSavedTurnReviewStore";
it("captures immutable review scope and per-item findings without following active sessions", () => {
  const scope = { requestThreadId: "request", reviewThreadId: "review", turnId: "turn", cwd: "/project", target: { type: "baseBranch" as const, branch: "main" } };
  const store = useSavedTurnReviewStore.getState();
  store.captureReviewScope(scope); scope.target.branch = "foreign";
  store.projectFindings({ threadId: "review", turnId: "turn", itemId: "item", cwd: "/project", findings: [{ id: "f", title: "finding", body: "fix", path: "/project/a.ts", start: 2, end: 2, side: "new" }] });
  expect(useSavedTurnReviewStore.getState().reviewScopes[reviewOwnerKey({ threadId: "review", turnId: "turn", cwd: "/project" })].target).toEqual({ type: "baseBranch", branch: "main" });
  expect(useSavedTurnReviewStore.getState().findingItems[reviewOwnerKey({ threadId: "review", turnId: "turn", cwd: "/foreign" })]).toBeUndefined();
  store.projectFindings({ threadId: "review", turnId: "turn", itemId: "item", cwd: "/project", findings: [] });
  expect(useSavedTurnReviewStore.getState().findingItems[reviewOwnerKey({ threadId: "review", turnId: "turn", cwd: "/project" })].item).toEqual([]);
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
