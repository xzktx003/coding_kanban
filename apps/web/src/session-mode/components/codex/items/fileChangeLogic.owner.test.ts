import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import {
  completedTurnChanges,
  aggregateFileChanges,
  getDiffViewerProps,
} from "./fileChangeLogic";
const delta = (threadId: string, diff: string) =>
  ({
    method: "turn/diff/updated",
    params: { threadId, turnId: "same-turn", diff },
  }) as ServerNotification;
const change = {
  path: "/project/file.ts",
  kind: { type: "update" as const, move_path: null },
  diff: "@@ -1 +1 @@\n-old\n+last-fragment\n",
};
it("completed turn review prefers its saved net patch over the last item fragment, and rejects a foreign turn diff", () => {
  const good =
    "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -80,1 +80,2 @@\n-old\n+net\n+added\n";
  const events = [
    delta("own", good),
    delta("foreign", "diff --git a/secret b/secret\n@@ -1 +1 @@\n-x\n+y\n"),
  ];
  const result = completedTurnChanges(
    "own",
    "same-turn",
    [
      {
        type: "fileChange",
        id: "patch",
        status: "completed",
        changes: [change],
      },
    ] as any,
    { events, eventIndex: events.length - 1 },
  );
  expect(result.changes).toHaveLength(1);
  expect(result.changes[0]).toMatchObject({
    path: "file.ts",
    diff: good,
    addedCount: 2,
  });
  expect(result.batches).toEqual([{ id: "patch", changes: [change] }]);
});
it("failed or declined file changes never become applied-turn undo receipts", () => {
  const result = completedTurnChanges("own", "turn", [
    { type: "fileChange", id: "failed", status: "failed", changes: [change] },
  ] as any);
  expect(result.changes).toEqual([]);
  expect(result.batches).toEqual([]);
});
it("keeps added/deleted saved hunks and native coordinates instead of converting them to line-one fragments", () => {
  for (const type of ["add", "delete"] as const) {
    const patch =
      type === "add"
        ? "--- /dev/null\n+++ b/file.ts\n@@ -0,0 +80,1 @@\n+added\n"
        : "--- a/file.ts\n+++ /dev/null\n@@ -80,1 +0,0 @@\n-removed\n";
    const [change] = aggregateFileChanges([
      { path: "file.ts", kind: { type }, diff: patch },
    ]);
    expect(change.diff).toBe(patch);
    expect(getDiffViewerProps(change).unifiedDiff).toBe(patch);
    expect(change.addedCount).toBe(type === "add" ? 1 : 0);
    expect(change.removedCount).toBe(type === "delete" ? 1 : 0);
  }
});

it("retains unloaded file metadata through completion and aggregation without treating an earlier body as the latest patch", () => {
  const projected = { ...change, diff: "", transcriptMetadataOnly: true };
  const result = completedTurnChanges("own", "turn", [
    {
      type: "fileChange",
      id: "patch",
      status: "completed",
      changes: [projected],
    },
  ] as any);
  expect(result.changes).toMatchObject([
    { path: change.path, diff: "", transcriptMetadataOnly: true },
  ]);
  expect(result.batches[0].changes[0]).toMatchObject({
    transcriptMetadataOnly: true,
  });
  expect(aggregateFileChanges([change, projected])[0]).toMatchObject({
    diff: "",
    transcriptMetadataOnly: true,
  });
  expect(aggregateFileChanges([projected, change])[0]).toMatchObject({
    diff: change.diff,
  });
  expect(aggregateFileChanges([projected, change])[0]).not.toHaveProperty(
    "transcriptMetadataOnly",
  );
});
