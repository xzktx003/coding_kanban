import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { countClosedThreadRecords } from "./closedThreadRecords";
const closed = (threadId: string) =>
  ({ method: "thread/closed", params: { threadId } }) as ServerNotification;
it("counts only matching closure events and does not change their protocol data", () => {
  const events = Object.freeze([
    closed("owner"),
    closed("other"),
    closed("owner"),
    {
      method: "warning",
      params: { message: "important" },
    } as ServerNotification,
  ]);
  expect(countClosedThreadRecords(events, "owner")).toBe(2);
  expect(countClosedThreadRecords(events, "other")).toBe(1);
  expect(countClosedThreadRecords(events, "")).toBe(0);
  expect(events).toHaveLength(4);
});
it("recomputes from a replaced snapshot instead of retaining a cumulative event cache", () => {
  expect(
    countClosedThreadRecords([closed("owner"), closed("owner")], "owner"),
  ).toBe(2);
  expect(countClosedThreadRecords([closed("owner")], "owner")).toBe(1);
  expect(countClosedThreadRecords([], "owner")).toBe(0);
});
