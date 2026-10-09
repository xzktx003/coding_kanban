import { beforeEach, expect, it } from "vitest";
import { useCodexStore } from "./useCodexStore";
beforeEach(() =>
  useCodexStore.setState({
    events: {},
    commandStatusMap: {},
    commandDurationMap: {},
  }),
);
const command = (method: "item/started" | "item/completed", turnId = "turn") =>
  ({
    method,
    params: {
      threadId: "thread",
      turnId,
      item: {
        id: "cmd",
        type: "commandExecution",
        command: "test",
        commandActions: [],
        status: method === "item/started" ? "inProgress" : "completed",
        aggregatedOutput: method === "item/started" ? null : "passed",
        durationMs: 7,
      },
    },
  }) as any;
it("a stale started replay cannot regress the completed command status maps", () => {
  useCodexStore.getState().addEvent("thread", command("item/completed"));
  const before = useCodexStore.getState();
  useCodexStore.getState().addEvent("thread", command("item/started"));
  expect(useCodexStore.getState().commandStatusMap.cmd).toBe("completed");
  expect(useCodexStore.getState().commandDurationMap.cmd).toBe(7);
  expect(useCodexStore.getState()).toBe(before);
});
it("accepts a new turn even if its command reuses an older item id", () => {
  useCodexStore.getState().addEvent("thread", command("item/completed"));
  useCodexStore
    .getState()
    .addEvent("thread", command("item/started", "new-turn"));
  expect(useCodexStore.getState().commandStatusMap.cmd).toBe("inProgress");
});
