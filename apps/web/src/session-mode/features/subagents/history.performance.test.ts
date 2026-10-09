import { expect, test, vi } from "vitest";
import { observeSubagentHistory, useSubagentStore } from "./store";

test("background updates do not rescan unchanged parent history, while new native events still arrive", () => {
  useSubagentStore.setState({ nodes: {}, revision: 0 });
  const event: any = {
    method: "item/completed",
    params: {
      threadId: "parent",
      turnId: "turn",
      item: {
        id: "spawn",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        senderThreadId: "parent",
        receiverThreadIds: ["child"],
        agentsStates: {},
      },
    },
  };
  const iterator = vi.fn(function* () {
    yield event;
    for (let i = 0; i < 10000; i++)
      yield {
        method: "item/agentMessage/delta",
        params: { threadId: "parent", delta: "正文" },
      } as any;
  });
  const history = Object.assign([], { [Symbol.iterator]: iterator });
  for (let i = 0; i < 30; i++) observeSubagentHistory(history);
  expect(iterator).toHaveBeenCalledOnce();
  expect(useSubagentStore.getState().nodes.child.createdInTurn).toBe("turn");
  const next: any = {
    method: "thread/started",
    params: {
      thread: {
        id: "child",
        parentThreadId: "parent",
        canAcceptDirectInput: false,
        status: { type: "idle" },
      },
    },
  };
  observeSubagentHistory([event, next]);
  expect(useSubagentStore.getState().nodes.child.verified).toBe(true);
  expect(
    useSubagentStore.getState().nodes.child.thread.canAcceptDirectInput,
  ).toBe(false);
});
