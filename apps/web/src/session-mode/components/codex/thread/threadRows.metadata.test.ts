import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";

it("retains control notifications in the source log without projecting JSON chat rows", () => {
  const events = [
    "thread/readState/changed",
    "thread/queue/changed",
    "serverRequest/resolved",
    "account/updated",
    "thread/metadata/updated",
  ].map((method, index) => ({
    method,
    params: {
      threadId: "thread",
      requestId: index,
      readState: { revision: "1" },
    },
  })) as unknown as ServerNotification[];
  expect(buildThreadRows(events)).toEqual([]);
  expect(events).toHaveLength(5);
  expect(events[0].method).toBe("thread/readState/changed");
});
