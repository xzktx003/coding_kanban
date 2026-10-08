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
    expect(nodes.child.thread.canAcceptDirectInput).toBeUndefined();
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
