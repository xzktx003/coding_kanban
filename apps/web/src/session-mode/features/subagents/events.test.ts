import { expect, it } from "vitest";
import { buildThreadRows } from "@session/components/codex/thread/threadRows";
import { observeSubagents, useSubagentStore } from "./store";
it("observes collab progress without rendering tool rows in the chat transcript", () => {
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  const item = {
    id: "spawn",
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    senderThreadId: "root",
    receiverThreadIds: ["child"],
    agentsStates: {},
    prompt: "inspect",
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
  expect(buildThreadRows([start]).length).toBe(0);
  expect(buildThreadRows([start, done]).length).toBe(0);
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
