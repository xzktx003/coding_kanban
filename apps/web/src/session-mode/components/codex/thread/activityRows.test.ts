import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";
import { groupThreadActivities } from "./activityRows";

const item = (
  type: string,
  id: string,
  fields: object = {},
  owner = "owner",
  turn = "turn",
) => ({
  method: "item/completed",
  params: { threadId: owner, turnId: turn, item: { type, id, ...fields } },
});
const command = (id: string, status = "completed", type = "unknown") =>
  item("commandExecution", id, {
    command: `echo ${id}`,
    commandActions: [
      {
        type,
        command: `echo ${id}`,
        name: `${id}.ts`,
        path: `/owner/${id}.ts`,
      },
    ],
    cwd: "/owner",
    status,
    exitCode: status === "completed" ? 0 : null,
    aggregatedOutput: id,
  });
const patch = item("fileChange", "patch", {
  status: "completed",
  changes: [
    {
      path: "/owner/file.ts",
      kind: { type: "update", move_path: null },
      diff: "@@ -1 +1 @@\n-old\n+new\n",
    },
  ],
});
const tool = item("mcpToolCall", "tool", {
  server: "fixture",
  tool: "lookup",
  status: "completed",
  arguments: {},
  result: { content: [] },
  durationMs: 10,
});
const reply = item("agentMessage", "reply", { text: "done" });
const rows = (events: any[]) =>
  groupThreadActivities(
    buildThreadRows(events as ServerNotification[]),
    events as ServerNotification[],
  );

it("groups mixed commands, reads, MCP and patches in source order and keeps reply separate", () => {
  const result = rows([
    command("read", "completed", "read"),
    tool,
    patch,
    command("command"),
    reply,
  ]);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    activity: {
      threadId: "owner",
      turnId: "turn",
      state: { kind: "summary" },
      canExpand: true,
    },
  });
  expect(
    (result[0] as any).activity.entries.map((entry: any) =>
      entry.kind === "command"
        ? entry.source.commandItemId
        : entry.row.item.event.params.item.id,
    ),
  ).toEqual(["read", "tool", "patch", "command"]);
  expect(result[1].item).toMatchObject({ kind: "event", event: reply });
});
it("keeps a stable group identity when pending tools finish and more tools arrive", () => {
  const pending = { ...command("first", "inProgress"), method: "item/started" };
  const before = rows([pending, tool]);
  const after = rows([pending, command("first"), tool, command("last")]);
  expect(before).toHaveLength(1);
  expect(after).toHaveLength(1);
  expect(before[0].key).toBe(after[0].key);
  expect((before[0] as any).activity.state).toMatchObject({
    kind: "active",
    entry: { kind: "command", source: { commandItemId: "first" } },
  });
});
it("uses thinking between the last completed action and the verified turn end", () => {
  const start = {
    method: "turn/started",
    params: {
      threadId: "owner",
      turn: { id: "turn", status: "inProgress", items: [] },
    },
  };
  expect(rows([start, command("one"), tool])[0]).toMatchObject({
    activity: { state: { kind: "thinking" } },
  });
  const end = {
    method: "turn/completed",
    params: {
      threadId: "owner",
      turn: { id: "turn", status: "completed", items: [] },
    },
  };
  expect(rows([start, command("one"), tool, end])[0]).toMatchObject({
    activity: { state: { kind: "summary" } },
  });
});
it("does not group across owners, turns, public reasoning or user messages", () => {
  const reason = item("reasoning", "reason", {
    summary: ["public"],
    content: [],
  });
  const other = item(
    "mcpToolCall",
    "other",
    {
      server: "fixture",
      tool: "lookup",
      status: "completed",
      arguments: {},
      result: { content: [] },
    },
    "different",
    "turn",
  );
  const result = rows([
    command("first"),
    tool,
    reason,
    patch,
    other,
    item(
      "mcpToolCall",
      "next",
      {
        server: "fixture",
        tool: "lookup",
        status: "completed",
        arguments: {},
        result: { content: [] },
      },
      "different",
      "new-turn",
    ),
  ]);
  expect(result).toHaveLength(5);
  expect(result[0]).toHaveProperty("activity");
  expect(result[1].item).toMatchObject({ kind: "event", event: reason });
  expect(result[2]).not.toHaveProperty("activity");
});
it("pending-only exploration has a truthful active header with no empty disclosure", () => {
  const result = rows([
    { ...command("read", "inProgress", "read"), method: "item/started" },
  ]);
  expect(result[0]).toMatchObject({
    activity: { state: { kind: "active" }, canExpand: false },
  });
});
it("tracks pending patches in place and replaces them with their completed snapshot", () => {
  const pending = {
    ...patch,
    method: "item/started",
    params: {
      ...patch.params,
      item: { ...patch.params.item, status: "inProgress" },
    },
  };
  const before = rows([command("one"), pending]);
  const after = rows([command("one"), pending, patch]);
  expect(before[0]).toMatchObject({
    activity: {
      state: {
        kind: "active",
        entry: { kind: "event", row: { item: { event: pending } } },
      },
    },
  });
  expect(after[0]).toMatchObject({
    activity: {
      entries: [
        expect.any(Object),
        { kind: "event", row: { item: { event: patch } } },
      ],
    },
  });
  expect(before[0].key).toBe(after[0].key);
});
it("a terminal turn settles missing tool-end events without inventing success", () => {
  const pending = {
    ...tool,
    method: "item/started",
    params: {
      ...tool.params,
      item: { ...tool.params.item, status: "inProgress" },
    },
  };
  const end = {
    method: "turn/completed",
    params: {
      threadId: "owner",
      turn: { id: "turn", status: "interrupted", items: [] },
    },
  };
  const result = rows([command("one"), pending, end]);
  expect(result[0]).toMatchObject({ activity: { state: { kind: "summary" } } });
  const entry = (result[0] as any).activity.entries[1];
  expect(entry.row.context?.renderTermination).toBe("interrupted");
  expect(entry.row.item.event.params.item.status).toBe("inProgress");
});
it("settles pending presentation using verified runtime timing without changing item status", () => {
  const events = [
    { ...command("one", "inProgress"), method: "item/started" },
    tool,
  ] as ServerNotification[];
  const result = groupThreadActivities(buildThreadRows(events), events, {
    threadId: "owner",
    turnId: null,
    running: false,
    terminal: { turnId: "turn", status: "failed" },
  });
  expect((result[0] as any).activity.entries[0]).toMatchObject({
    pending: false,
    source: { status: "inProgress", termination: "failed" },
  });
});
it("notices updates inside a group even when its first and last items stay the same", () => {
  const first = command("first"),
    last = command("last", "inProgress");
  const before = rows([first, tool, last])[0].activity as any;
  const changed = {
    ...tool,
    params: {
      ...tool.params,
      item: {
        ...tool.params.item,
        result: { content: [{ type: "text", text: "new body" }] },
      },
    },
  };
  const after = rows([first, tool, last, changed])[0].activity as any;
  expect(before.revision).not.toBe(after.revision);
  const status = {
    method: "thread/tokenUsage/updated",
    params: { threadId: "owner", tokenUsage: {} },
  };
  expect(
    (rows([first, tool, last, changed, status])[0].activity as any).revision,
  ).toBe(after.revision);
});
const review = (status: string, owner = "owner", target = "item") => ({
  method:
    status === "inProgress"
      ? "item/autoApprovalReview/started"
      : "item/autoApprovalReview/completed",
  params: {
    threadId: owner,
    turnId: "turn",
    reviewId: "review",
    targetItemId: target,
    startedAtMs: 1,
    ...(status === "inProgress"
      ? {}
      : { completedAtMs: 2, decisionSource: "agent" }),
    review: {
      status,
      riskLevel: "high",
      userAuthorization: "unknown",
      rationale: "Need scope",
    },
    action: {
      type: "command",
      source: "shell",
      command: "curl target",
      cwd: "/owner",
    },
  },
});
it("coalesces exact native review identity and moves denied results to standalone without splitting unrelated owners", () => {
  const result = rows([
    command("one"),
    review("inProgress"),
    review("denied"),
    review("approved", "other"),
  ]);
  expect(result).toHaveLength(2);
  expect(result[1].activityEntry).toMatchObject({
    kind: "review",
    pending: false,
    value: { review: { status: "denied" }, targetItemId: "item" },
  });
  expect(result[0].activityEntry).toMatchObject({ kind: "command" });
  const pending = rows([command("one"), review("inProgress")]);
  expect(pending[0].activity?.state).toEqual({ kind: "thinking" });
});
it("does not collapse reviews that reused a reviewId for another target or owner", () => {
  const result = rows([
    review("denied"),
    review("denied", "owner", "different"),
    review("denied", "other"),
  ]);
  expect(result).toHaveLength(3);
  expect(new Set(result.map((row) => row.key)).size).toBe(3);
});
it("coalesces consecutive inspected and generated images only within the same native owner and round", () => {
  const result = rows([
    item("imageView", "one", { path: "/owner/one.png" }),
    item("imageView", "two", { path: "/owner/two.png" }),
    item("imageGeneration", "gen-one", { result: "one", status: "completed" }),
    item("imageGeneration", "gen-two", { result: "two", status: "completed" }),
    item(
      "imageGeneration",
      "other",
      { result: "other", status: "completed" },
      "other",
    ),
  ]);
  expect(result).toHaveLength(3);
  expect((result[0].item as any).event.params.item).toMatchObject({
    imagePaths: ["/owner/one.png", "/owner/two.png"],
    imageCount: 2,
  });
  expect(
    (result[1].item as any).event.params.item.images.map(
      (image: any) => image.id,
    ),
  ).toEqual(["gen-one", "gen-two"]);
  expect((result[2].item as any).event.params.threadId).toBe("other");
});
it("respects native dynamic standalone, hidden and summary-only presentation metadata", () => {
  const result = rows([
    command("one"),
    item("dynamicToolCall", "hidden", {
      namespace: "codex_app",
      tool: "update_up_next",
      status: "completed",
    }),
    item("dynamicToolCall", "handoff", {
      namespace: "codex_app",
      tool: "handoff_thread",
      status: "completed",
    }),
    command("two"),
    item("dynamicToolCall", "status", {
      namespace: "codex_app",
      tool: "get_handoff_status",
      status: "completed",
    }),
  ]);
  expect(result).toHaveLength(3);
  expect(result[1].activityEntry).toMatchObject({
    kind: "event",
    item: { tool: "handoff_thread" },
  });
  expect(result[2].activity?.entries[1]).toMatchObject({
    item: { tool: "get_handoff_status" },
    bodyVisible: false,
  });
});
