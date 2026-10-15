import { beforeEach, expect, it } from "vitest";
import { observeSubagents, useSubagentStore } from "./store";
import { reconcileNodes } from "./model";

const created = (id = "child", parent = "root") =>
  ({
    method: "item/completed",
    params: {
      threadId: parent,
      turnId: "turn",
      item: {
        id: `spawn-${id}`,
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        senderThreadId: parent,
        receiverThreadIds: [id],
        agentsStates: {},
        status: "completed",
      },
    },
  }) as any;
beforeEach(() =>
  useSubagentStore.setState({ nodes: {}, identities: {}, revision: 0 }),
);

it.each(["sendMessage", "resumeAgent", "wait", "closeAgent"])(
  "%s to a parent or another main thread never creates a child relationship",
  (tool) => {
    observeSubagents(created());
    observeSubagents({
      method: "item/completed",
      params: {
        threadId: "child",
        turnId: "child-turn",
        item: {
          id: "communication",
          type: "collabAgentToolCall",
          tool,
          senderThreadId: "child",
          receiverThreadIds: ["root", "other-main", "child"],
          agentsStates: { root: { status: "running" } },
        },
      },
    } as any);
    expect(Object.keys(useSubagentStore.getState().nodes)).toEqual(["child"]);
    expect(useSubagentStore.getState().nodes.child.parentId).toBe("root");
  },
);

it.each(["interacted", "completed", "stopped"])(
  "V2 subAgentActivity.%s does not invent a parent edge",
  (kind) => {
    observeSubagents({
      method: "item/completed",
      params: {
        threadId: "child",
        turnId: "child-turn",
        item: {
          id: "activity",
          type: "subAgentActivity",
          kind,
          agentThreadId: "root",
          agentPath: "/0",
        },
      },
    } as any);
    expect(useSubagentStore.getState().nodes).toEqual({});
  },
);

it("fresh explicit main metadata clears a legacy false child without switching input or selection", () => {
  observeSubagents(created("root", "child"));
  useSubagentStore.setState({
    selection: { child: "root" },
    panelRoot: "child",
  });
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "root",
        source: "vscode",
        parentThreadId: null,
      },
    },
  } as any);
  expect(useSubagentStore.getState().nodes.root).toBeUndefined();
  expect(useSubagentStore.getState().selection).toEqual({ child: "root" });
  expect(useSubagentStore.getState().panelRoot).toBe("child");
});

it("raw main metadata removes a bad relationship instead of merging its old parent into the main", () => {
  const bad: any = {
    thread: { id: "root" },
    parentId: "child",
    verified: false,
    revision: 0,
  };
  expect(
    reconcileNodes(
      { root: bad },
      [{ id: "root", source: "cli", parentThreadId: null }],
      0,
    ),
  ).toEqual({});
});

it("a late snapshot cannot restore permission revoked by a newer native event", () => {
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "child",
        parentThreadId: "root",
        canAcceptDirectInput: true,
      },
    },
  } as any);
  const baseline = useSubagentStore.getState().revision;
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "child",
        parentThreadId: "root",
        canAcceptDirectInput: false,
      },
    },
  } as any);
  useSubagentStore.getState().apply(
    "root",
    {
      threads: [
        { id: "child", parentThreadId: "root", canAcceptDirectInput: true },
      ],
      complete: true,
      errors: [],
      checkedAt: 1,
    },
    baseline,
  );
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBe(false);
});

it("a late snapshot cannot revive a node cleared by current main metadata", () => {
  observeSubagents(created("root", "child"));
  const baseline = useSubagentStore.getState().revision;
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "root",
        source: "appServer",
        parentThreadId: null,
      },
    },
  } as any);
  useSubagentStore.getState().apply(
    "child",
    {
      threads: [
        { id: "root", parentThreadId: "child", canAcceptDirectInput: true },
      ],
      complete: true,
      errors: [],
      checkedAt: 1,
    },
    baseline,
  );
  expect(useSubagentStore.getState().nodes.root).toBeUndefined();
});

it("self-spawn never creates a cyclic relationship", () => {
  observeSubagents(created("root", "root"));
  expect(useSubagentStore.getState().nodes).toEqual({});
});

it("communication cannot overwrite a confirmed recipient's native model settings with the sender's settings", () => {
  observeSubagents({
    method: "thread/started",
    params: {
      thread: {
        id: "child",
        parentThreadId: "root",
        model: "child-model",
        reasoningEffort: "low",
        canAcceptDirectInput: true,
      },
    },
  } as any);
  observeSubagents({
    method: "item/completed",
    params: {
      threadId: "other-main",
      turnId: "other-turn",
      item: {
        id: "communication",
        type: "collabAgentToolCall",
        tool: "sendMessage",
        senderThreadId: "other-main",
        receiverThreadIds: ["child"],
        model: "sender-model",
        reasoningEffort: "high",
      },
    },
  } as any);
  expect(useSubagentStore.getState().nodes.child.thread.model).toBe(
    "child-model",
  );
  expect(useSubagentStore.getState().nodes.child.thread.reasoningEffort).toBe(
    "low",
  );
});
