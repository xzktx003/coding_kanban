import { beforeEach, expect, it } from "vitest";
import { subagentStorageKey } from "./scope";
import { useSubagentStore } from "./store";
import { mentionDrafts, useAgentMentionDrafts } from "./mentions";
beforeEach(() => {
  localStorage.clear();
  useAgentMentionDrafts.setState({ drafts: {} });
});
it("cached state never grants permission or wins over a fresh snapshot after reload", async () => {
  localStorage.setItem(
    subagentStorageKey(),
    JSON.stringify({
      version: 1,
      state: {
        nodes: {
          child: {
            parentId: "root",
            verified: true,
            revision: 500,
            thread: {
              id: "child",
              parentThreadId: "root",
              canAcceptDirectInput: true,
              status: { type: "active" },
            },
          },
        },
        selection: { root: "child" },
      },
    }),
  );
  await useSubagentStore.persist.rehydrate();
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBeNull();
  expect(useSubagentStore.getState().nodes.child.thread.status?.type).toBe(
    "notLoaded",
  );
  useSubagentStore.getState().apply(
    "root",
    {
      threads: [
        {
          id: "child",
          parentThreadId: "root",
          status: { type: "idle" },
          canAcceptDirectInput: false,
        },
      ],
      complete: true,
      errors: [],
      checkedAt: 1,
    },
    0,
  );
  expect(useSubagentStore.getState().nodes.child.thread.status?.type).toBe(
    "idle",
  );
  expect(useSubagentStore.getState().selection.root).toBe("child");
});
it("mentions are isolated and a late receipt preserves references reselected while sending", () => {
  mentionDrafts.add("a", { name: "reviewer", path: "subagent://reviewer" });
  const submitted = mentionDrafts.read("a");
  mentionDrafts.add("b", { name: "Atlas", path: "agent://child" });
  mentionDrafts.add("a", { name: "reviewer", path: "subagent://reviewer" });
  mentionDrafts.clear("a", submitted);
  expect(mentionDrafts.read("a")).toHaveLength(1);
  expect(mentionDrafts.read("b")[0].path).toBe("agent://child");
});

it("request markers separate reused native ids without retaining old answer drafts", async () => {
  const { sameRpc } =
    await import("@session/components/codex/stores/rpcLifecycle");
  const { requestUserInputKey } =
    await import("@session/components/codex/stores/useRequestUserInputStore");
  const previous = {
    threadId: "child",
    requestId: 1,
    turnId: "t",
    itemId: "i",
    requestToken: "old",
    questions: [],
  };
  const next = { ...previous, requestToken: "new" };
  expect(sameRpc(previous, next)).toBe(false);
  expect(requestUserInputKey(previous)).not.toBe(requestUserInputKey(next));
});
