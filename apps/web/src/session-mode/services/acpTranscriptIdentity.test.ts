import { beforeEach, expect, it } from "vitest";
import {
  foldPersistentAcpUpdate,
  acknowledgeAcpPrompt,
  mergeAcpTranscriptPage,
} from "./acpTranscriptIdentity";
import type { AcpEntry } from "../stores/useAcpStore";

const chunk = (text: string) => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});
it("matches persistent chunk boundaries and tool IDs across live updates and readonly reconstruction", () => {
  let rows: AcpEntry[] = [];
  rows = foldPersistentAcpUpdate(rows, chunk("first "), 2);
  rows = foldPersistentAcpUpdate(rows, chunk("second"), 3);
  expect(rows).toEqual([
    { id: "acp-2-0", role: "agent", text: "first second", historySourceId: 3 },
  ]);
  rows = foldPersistentAcpUpdate(
    rows,
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read",
      status: "pending",
      rawInput: { path: "source" },
    },
    4,
  );
  rows = foldPersistentAcpUpdate(
    rows,
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
    },
    5,
  );
  expect(rows[1]).toMatchObject({
    id: "acp-tool-7998d275087ee3f171d53721",
    title: "Read",
    status: "completed",
    rawInput: { path: "source" },
    historySourceId: 5,
  });
  rows = foldPersistentAcpUpdate(rows, chunk("x".repeat(64 * 1024)), 6);
  rows = foldPersistentAcpUpdate(rows, chunk("tail"), 7);
  expect(rows.slice(-2).map((row) => row.id)).toEqual(["acp-6-0", "acp-7-0"]);
});
it("correlates only exact optimistic client IDs and keeps text/image persisted rows distinct", () => {
  const initial: AcpEntry[] = [
    {
      id: "optimistic",
      role: "user",
      clientMessageId: "same",
      text: "question",
      images: ["/one", "/two"],
    },
    { id: "other", role: "user", clientMessageId: "other", text: "question" },
  ];
  const rows = acknowledgeAcpPrompt(initial, "same", [
    { historySourceId: 10, partIndex: 0 },
    { historySourceId: 11, partIndex: 1 },
    { historySourceId: 12, partIndex: 2 },
  ]);
  expect(rows.slice(0, 3).map((row) => row.id)).toEqual([
    "acp-10-0",
    "acp-11-0",
    "acp-12-0",
  ]);
  expect(rows[0]).toMatchObject({
    text: "question",
    clientMessageId: "same",
    partIndex: 0,
  });
  expect(rows[1]).toMatchObject({ text: "", images: ["/one"], partIndex: 1 });
  expect(rows[2]).toMatchObject({ text: "", images: ["/two"], partIndex: 2 });
  expect(rows[3]).toBe(initial[1]);
  expect(
    acknowledgeAcpPrompt(rows, "same", [
      { historySourceId: 10, partIndex: 0 },
      { historySourceId: 11, partIndex: 1 },
      { historySourceId: 12, partIndex: 2 },
    ]),
  ).toBe(rows);
});
it("a delayed recent page preserves newer exact source changes without duplicate text or overwriting a new prompt", () => {
  const recent: AcpEntry[] = [
    { id: "acp-1-0", role: "user", text: "question", historySourceId: 1 },
    { id: "acp-2-0", role: "agent", text: "first ", historySourceId: 2 },
  ];
  const live: AcpEntry[] = [
    recent[0],
    { id: "acp-2-0", role: "agent", text: "first second", historySourceId: 3 },
    {
      id: "optimistic",
      role: "user",
      text: "question",
      clientMessageId: "new",
    },
  ];
  const merged = mergeAcpTranscriptPage(live, recent, 2, false);
  expect(merged).toHaveLength(3);
  expect(merged[1]).toMatchObject({ text: "first second" });
  expect(merged[2]).toBe(live[2]);
});

it("keeps exact source image and detail metadata when the gateway replaces an unsafe inline image with a text preview", () => {
  const rows = foldPersistentAcpUpdate(
    [],
    {
      sessionUpdate: "user_message_chunk",
      clientMessageId: "client",
      partIndex: 1,
      content: { type: "text", text: "[image preview unavailable]" },
      truncated: true,
      historyDetail: { itemId: "source-9" },
      historyImages: [{ index: 0, mimeType: "image/png" }],
    },
    9,
  );
  expect(rows).toEqual([
    {
      id: "acp-9-0",
      role: "user",
      text: "[image preview unavailable]",
      clientMessageId: "client",
      partIndex: 1,
      historySourceId: 9,
      truncated: true,
      historyDetail: { itemId: "source-9" },
      historyImages: [{ index: 0, mimeType: "image/png" }],
    },
  ]);
});
