import { expect, it, vi } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { transcriptDiagnostics } from "./transcriptDiagnostics";
it("keeps unsupported events in bounded diagnostics without treating them as chat or serializing payloads", () => {
  const toJSON = vi.fn(() => "large result");
  const events = Array.from({ length: 100 }, (_, i) => ({
    method: "future/tool",
    params: { threadId: "owner", turnId: "turn", itemId: String(i), toJSON },
  })) as unknown as ServerNotification[];
  expect(buildThreadRows(events)).toEqual([]);
  const records = transcriptDiagnostics(events, "owner");
  expect(records).toHaveLength(32);
  expect(records[0].itemId).toBe("68");
  expect(toJSON).not.toHaveBeenCalled();
  expect(JSON.stringify(records)).not.toContain("large result");
  expect(events).toHaveLength(100);
});
it("keeps future payload-less notifications inspectable without requiring chat-shaped params", () => {
  const events = [
    { method: "future/notification", params: null },
    { method: "future/notification", params: "opaque" },
  ] as unknown as ServerNotification[];
  expect(buildThreadRows(events)).toEqual([]);
  expect(
    transcriptDiagnostics(events, "owner").map((record) => record.method),
  ).toEqual(["future/notification", "future/notification"]);
});
