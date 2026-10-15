import { describe, expect, it } from "vitest";
import {
  descendants,
  inParentTurn,
  reconcileNodes,
  childState,
  selectStopTargets,
  type SubagentNode,
} from "./model";
const node = (id: string, parentId: string, turn = "old"): SubagentNode => ({
  thread: { id, parentThreadId: parentId, status: { type: "idle" } },
  parentId,
  verified: true,
  createdInTurn: turn,
  revision: 1,
});
describe("subagent family model", () => {
  it("execution events do not keep an old grant alive when fresh metadata is sparse", () => {
    const previous = {
      ...node("child", "root"),
      revision: 5,
      metadataRevision: 1,
      thread: {
        id: "child",
        parentThreadId: "root",
        canAcceptDirectInput: true,
        status: { type: "active" },
      },
    };
    const result = reconcileNodes({ child: previous }, [{ id: "child" }], 1, 6);
    expect(result.child.thread.canAcceptDirectInput).toBeNull();
    expect(result.child.thread.status?.type).toBe("active");
    expect(result.child.parentId).toBe("root");
    expect(result.child.metadataRevision).toBe(6);
  });
  it("fresh sparse metadata withdraws a previously granted direct-input capability", () => {
    const previous = node("child", "root");
    previous.thread.canAcceptDirectInput = true;
    const result = reconcileNodes(
      { child: previous },
      [{ id: "child", parentThreadId: "root", status: { type: "idle" } }],
      1,
    );
    expect(result.child.thread.canAcceptDirectInput).toBeNull();
    expect(result.child.parentId).toBe("root");
  });

  it.each([true, false])(
    "a delayed snapshot cannot overwrite newer native identity or permission (%s)",
    (capability) => {
      const previous = node("child", "current-parent");
      previous.revision = 5;
      previous.thread.canAcceptDirectInput = capability;
      previous.thread.source = {
        subAgent: { thread_spawn: { parent_thread_id: "current-parent" } },
      };
      const result = reconcileNodes(
        { child: previous },
        [
          {
            id: "child",
            parentThreadId: "old-parent",
            source: {
              subAgent: { thread_spawn: { parent_thread_id: "old-parent" } },
            },
            canAcceptDirectInput: !capability,
          },
        ],
        2,
      );
      expect(result.child.parentId).toBe("current-parent");
      expect(result.child.thread.parentThreadId).toBe("current-parent");
      expect(result.child.thread.source).toEqual(previous.thread.source);
      expect(result.child.thread.canAcceptDirectInput).toBe(capability);
    },
  );

  it("delayed root metadata cannot erase a newer native child classification", () => {
    const previous = { ...node("child", "root"), revision: 5 };
    const result = reconcileNodes(
      { child: previous },
      [{ id: "child", source: "cli", parentThreadId: null }],
      2,
    );
    expect(result.child).toBe(previous);
  });

  it("authoritative main-thread metadata removes a false cached relationship", () => {
    const cached = {
      root: node("root", "child"),
      child: node("child", "root"),
    };
    const result = reconcileNodes(
      cached,
      [{ id: "root", source: "cli", parentThreadId: null }],
      1,
    );
    expect(result.root).toBeUndefined();
    expect(result.child).toBe(cached.child);
    expect(cached.root).toBeDefined();
  });

  it.each([
    { id: "child", parentThreadId: null },
    { id: "child", source: "unknown", parentThreadId: null },
    { id: "child", source: { subAgent: "review" }, parentThreadId: null },
    {
      id: "child",
      source: { subAgent: { thread_spawn: { parent_thread_id: "root" } } },
      parentThreadId: null,
    },
  ])(
    "unknown or child metadata never clears conservative child identity: %j",
    (thread) => {
      const result = reconcileNodes(
        { child: node("child", "root") },
        [thread],
        1,
      );
      expect(result.child.parentId).toBe("root");
      expect(result.child.thread.canAcceptDirectInput).not.toBe(true);
    },
  );

  it("restores legacy source nickname and role when thin top-level fields are absent", () => {
    const nodes = reconcileNodes(
      {},
      [
        {
          id: "child",
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: "root",
                agent_nickname: "Gauss",
                agent_role: "reviewer",
              },
            },
          },
        },
      ],
      0,
    );
    expect(nodes.child.thread.agentNickname).toBe("Gauss");
    expect(nodes.child.thread.agentRole).toBe("reviewer");
    expect(nodes.child.thread.canAcceptDirectInput).toBeNull();
  });
  it("walks nested ancestry without ordinary forks or cycles", () => {
    const nodes = {
      a: node("a", "root"),
      b: node("b", "a"),
      x: node("x", "else"),
      loop: node("loop", "loop"),
    };
    expect(descendants(nodes, "root").map((n) => n.thread.id)).toEqual([
      "a",
      "b",
    ]);
    expect(inParentTurn(nodes, "root", nodes.b, "old")).toBe(true);
    expect(inParentTurn(nodes, "root", nodes.b, "new")).toBe(false);
  });
  it("late snapshots preserve live evidence and incomplete responses retain known nodes", () => {
    const old = node("a", "root");
    old.revision = 5;
    old.thread.status = { type: "active" };
    const result = reconcileNodes(
      { a: old },
      [
        {
          id: "a",
          parentThreadId: "root",
          status: { type: "idle" },
          agentNickname: "Atlas",
        },
      ],
      2,
    );
    expect(result.a.thread.status?.type).toBe("active");
    expect(result.a.thread.agentNickname).toBe("Atlas");
    expect(reconcileNodes(result, [], 7).a).toEqual(result.a);
  });
  it("pending requests, failure and stopped outcomes remain distinct from idle", () => {
    expect(
      childState(
        { ...node("a", "root"), thread: { id: "a", status: { type: "idle" } } },
        undefined,
        1,
      ),
    ).toBe("pending");
    expect(
      childState(
        node("a", "root"),
        { turnId: "t", status: "interrupted", startedAtMs: 1, durationMs: 1 },
        0,
      ),
    ).toBe("stopped");
    expect(
      childState(
        node("a", "root"),
        { turnId: "t", status: "failed", startedAtMs: 1, durationMs: 1 },
        0,
      ),
    ).toBe("failed");
  });
  it("thin active metadata is safe and stale unavailable nodes cannot imply running", () => {
    const active = {
      ...node("a", "root"),
      thread: { id: "a", status: { type: "active" } },
    };
    expect(childState(active, undefined, 0)).toBe("running");
    expect(
      childState(
        { ...active, unavailable: true },
        {
          turnId: "old",
          status: "inProgress",
          startedAtMs: 1,
          durationMs: null,
        },
        0,
      ),
    ).toBe("unknown");
    expect(childState({ ...active, unavailable: true }, undefined, 1)).toBe(
      "pending",
    );
  });
  it("current-round batch stop excludes old and unknown birth rounds, while subtree stop is explicit", () => {
    const rows = [
      {
        node: node("a", "root"),
        current: true,
        state: "running" as const,
        turnId: "ta",
      },
      {
        node: node("b", "a"),
        current: false,
        state: "running" as const,
        turnId: "tb",
      },
      {
        node: node("old", "root"),
        current: false,
        state: "running" as const,
        turnId: "to",
      },
      {
        node: node("done", "root"),
        current: true,
        state: "completed" as const,
        turnId: "td",
      },
    ];
    expect(selectStopTargets(rows, false)).toEqual([
      { threadId: "a", turnId: "ta" },
    ]);
    expect(selectStopTargets(rows, true).map((t) => t.threadId)).toEqual([
      "a",
      "b",
      "old",
    ]);
    expect(
      selectStopTargets(rows, false, "a", true).map((t) => t.threadId),
    ).toEqual(["a", "b"]);
    expect(
      selectStopTargets(rows, false, "a", false).map((t) => t.threadId),
    ).toEqual(["a"]);
  });
});
