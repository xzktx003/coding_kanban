import { beforeEach, expect, it } from "vitest";
import { buildThreadRows } from "@session/components/codex/thread/threadRows";
import { observeSubagents, useSubagentStore } from "./store";
import { withoutToolTranscriptEvent } from "@session/services/codexTranscriptVisibility";
beforeEach(() =>
  useSubagentStore.setState({ nodes: {}, identities: {}, revision: 0 }),
);
it("observes collab progress and renders bounded identity metadata without retaining private bodies", () => {
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  const item = {
    id: "spawn",
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    senderThreadId: "root",
    receiverThreadIds: ["child"],
    agentsStates: {},
    prompt: "inspect" + "x".repeat(1024 * 1024),
    status: "inProgress",
  };
  const start: any = {
    method: "item/started",
    params: { threadId: "root", turnId: "turn", item },
  };
  const done: any = {
    method: "item/completed",
    params: { ...start.params, item: { ...item, status: "completed" } },
  };
  observeSubagents(start);
  observeSubagents(done);
  expect(useSubagentStore.getState().nodes.child.parentId).toBe("root");
  expect(useSubagentStore.getState().nodes.child.createdInTurn).toBe("turn");
  const safeStart = withoutToolTranscriptEvent(start)!;
  const safeDone = withoutToolTranscriptEvent(done)!;
  expect(buildThreadRows([safeStart]).length).toBe(1);
  expect(buildThreadRows([safeStart, safeDone]).length).toBe(1);
  expect((safeDone.params as any).item).toMatchObject({
    id: "spawn",
    receiverThreadIds: ["child"],
    status: "completed",
    transcriptMetadataOnly: true,
  });
  expect((safeDone.params as any).item.prompt.length).toBeLessThanOrEqual(1024);
  expect(JSON.stringify([safeStart, safeDone])).not.toContain(item.prompt);
});
it("activity reports do not grant direct input; native metadata confirms parent", () => {
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  observeSubagents({
    method: "item/started",
    params: {
      threadId: "root",
      turnId: "turn",
      item: {
        id: "act",
        type: "subAgentActivity",
        agentThreadId: "child",
        agentPath: "/1",
        kind: "started",
      },
    },
  } as any);
  expect(useSubagentStore.getState().nodes.child.verified).toBe(false);
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBeUndefined();
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "child",
        parentThreadId: "parent",
        canAcceptDirectInput: false,
      },
    },
  } as any);
  expect(useSubagentStore.getState().nodes.child.parentId).toBe("parent");
  expect(useSubagentStore.getState().nodes.child.verified).toBe(true);
});

it("historical spawn metadata neither revives an unavailable child nor defeats an in-flight snapshot", async () => {
  const { observeSubagentHistory } = await import("./store");
  useSubagentStore.setState({ nodes: {}, families: {}, revision: 0 });
  const native: any = {
    method: "thread/started",
    params: {
      thread: {
        id: "child",
        parentThreadId: "root",
        status: { type: "active" },
        canAcceptDirectInput: true,
      },
    },
  };
  observeSubagents(native);
  const baseline = useSubagentStore.getState().revision;
  const history = (): any => ({
    method: "item/completed",
    params: {
      threadId: "root",
      turnId: "old-turn",
      item: {
        id: "old-spawn",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        senderThreadId: "root",
        receiverThreadIds: ["child"],
        agentsStates: {},
        status: "completed",
      },
    },
  });
  observeSubagentHistory([history()]);
  expect(useSubagentStore.getState().nodes.child.revision).toBe(baseline);
  useSubagentStore.getState().apply(
    "root",
    {
      threads: [],
      complete: false,
      errors: [],
      checkedAt: 1,
      unavailableIds: ["child"],
    },
    baseline,
  );
  expect(useSubagentStore.getState().nodes.child.unavailable).toBe(true);
  observeSubagentHistory([history()]);
  expect(useSubagentStore.getState().nodes.child.unavailable).toBe(true);
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBeNull();
  // Only a fresh native event can confirm that the identity is available again.
  observeSubagents({
    ...native,
    params: { thread: { ...native.params.thread } },
  });
  expect(useSubagentStore.getState().nodes.child.unavailable).toBe(false);
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBe(true);
});
it.each(["sendInput", "wait", "resumeAgent", "closeAgent"])(
  "%s recipients do not establish parentage, including messages back to a main thread",
  (tool) => {
    useSubagentStore.setState({ nodes: {}, revision: 0 });
    observeSubagents({
      method: "thread/started",
      params: { thread: { id: "child", parentThreadId: "root" } },
    } as any);
    observeSubagents({
      method: "item/completed",
      params: {
        threadId: "child",
        turnId: "child-turn",
        item: {
          id: "reply",
          type: "collabAgentToolCall",
          tool,
          senderThreadId: "child",
          receiverThreadIds: ["root"],
          agentsStates: { stranger: { status: "running" } },
        },
      },
    } as any);
    expect(Object.keys(useSubagentStore.getState().nodes)).toEqual(["child"]);
    expect(useSubagentStore.getState().nodes.child.parentId).toBe("root");
  },
);

it("collaboration still updates an observed child without granting input", () => {
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  const item = {
    id: "spawn",
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    senderThreadId: "root",
    receiverThreadIds: ["child"],
  };
  observeSubagents({
    method: "item/completed",
    params: { threadId: "root", turnId: "turn", item },
  } as any);
  observeSubagents({
    method: "item/completed",
    params: {
      threadId: "root",
      turnId: "later",
      item: {
        ...item,
        tool: "wait",
        agentsStates: { child: { status: "running" } },
      },
    },
  } as any);
  expect(useSubagentStore.getState().nodes.child).toMatchObject({
    parentId: "root",
    createdInTurn: "turn",
    verified: false,
    thread: { status: { type: "active" } },
  });
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBeUndefined();
});

it.each(["started", "interacted"])(
  "activity %s cannot turn a known ancestor or the sender into its own descendant",
  (kind) => {
    useSubagentStore.setState({ nodes: {}, revision: 0 });
    observeSubagents({
      method: "thread/started",
      params: { thread: { id: "child", parentThreadId: "root" } },
    } as any);
    for (const agentThreadId of ["root", "child"])
      observeSubagents({
        method: "item/completed",
        params: {
          threadId: "child",
          turnId: "turn",
          item: { type: "subAgentActivity", kind, agentThreadId },
        },
      } as any);
    expect(Object.keys(useSubagentStore.getState().nodes)).toEqual(["child"]);
    expect(useSubagentStore.getState().nodes.child.parentId).toBe("root");
  },
);

it("interaction with an unknown thread does not infer a child relationship", () => {
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  observeSubagents({
    method: "item/completed",
    params: {
      threadId: "child",
      turnId: "turn",
      item: {
        type: "subAgentActivity",
        kind: "interacted",
        agentThreadId: "root",
      },
    },
  } as any);
  expect(useSubagentStore.getState().nodes).toEqual({});
});

it("fresh main-thread metadata removes a persisted false child classification", () => {
  useSubagentStore.setState({
    revision: 0,
    nodes: {
      root: {
        thread: { id: "root", canAcceptDirectInput: null },
        parentId: "child",
        verified: false,
        unavailable: true,
        revision: 0,
      },
    },
  });
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "root",
        source: "cli",
        parentThreadId: null,
        canAcceptDirectInput: null,
      },
    },
  } as any);
  expect(useSubagentStore.getState().nodes.root).toBeUndefined();
});

it("a fresh native child notification without capability withdraws the prior grant", () => {
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  for (const canAcceptDirectInput of [true, undefined])
    observeSubagents({
      method: "thread/started",
      params: {
        thread: {
          id: "child",
          parentThreadId: "root",
          ...(canAcceptDirectInput === undefined
            ? {}
            : { canAcceptDirectInput }),
        },
      },
    } as any);
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBeNull();
});
