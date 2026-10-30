import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import {
  streamingTranscriptPreview,
  transcriptPreview,
} from "./transcriptPreview";

it("keeps only exact-owner recent messages without tool JSON or duplicate native items", () => {
  const item = (
    threadId: string,
    id: string,
    type: string,
    text: string,
    method = "item/completed",
  ) => ({
    method,
    params: { threadId, turnId: "turn", item: { id, type, text } },
  });
  const events = [
    item("owner", "old", "agentMessage", "original", "item/started"),
    item("owner", "old", "agentMessage", "final"),
    item("owner", "tool", "mcpToolCall", "tool body"),
    item("other", "foreign", "agentMessage", "foreign body"),
  ];
  expect(
    transcriptPreview(events as ServerNotification[], "owner").map(
      (row) => row.text,
    ),
  ).toEqual(["final"]);
});

it("bounds retained text and live preview even before the rich module becomes available", () => {
  const events = Array.from({ length: 30 }, (_, index) => ({
    method: "item/completed",
    params: {
      threadId: "owner",
      turnId: "turn",
      item: {
        id: String(index),
        type: "agentMessage",
        text: "x".repeat(100_000) + index,
      },
    },
  }));
  const rows = transcriptPreview(events as ServerNotification[], "owner");
  expect(rows).toHaveLength(4);
  expect(rows.every((row) => row.text.length <= 4096)).toBe(true);
  const live = streamingTranscriptPreview({
    itemId: "live",
    turnId: "turn",
    segments: Array(20).fill("x".repeat(8192)),
    current: "last",
    length: 20 * 8192 + 4,
  });
  expect(live.length).toBeLessThanOrEqual(8192);
  expect(live.endsWith("last")).toBe(true);
});
