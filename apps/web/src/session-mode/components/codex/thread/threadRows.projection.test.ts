import { describe, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";

const event = (method: string, params: unknown) =>
  ({ method, params }) as ServerNotification;
const delta = (text: string, turnId = "turn", itemId = "answer") =>
  event("item/agentMessage/delta", {
    threadId: "thread",
    turnId,
    itemId,
    delta: text,
  });
const complete = (text: string, turnId = "turn", itemId = "answer") =>
  event("item/completed", {
    threadId: "thread",
    turnId,
    item: {
      type: "agentMessage",
      id: itemId,
      text,
      phase: "final_answer",
      memoryCitation: null,
    },
  });
const content = (events: ServerNotification[]) =>
  buildThreadRows(events).flatMap((row) =>
    row.item.kind === "event" ? [row.item.event] : [],
  );

describe("native item projection", () => {
  it("merges interleaved deltas and uses the authoritative complete text without changing the anchor", () => {
    const stream = [
      delta("first"),
      event("thread/tokenUsage/updated", {}),
      delta(" second"),
    ];
    const running = buildThreadRows(stream);
    expect(running).toHaveLength(1);
    expect(running[0].item).toMatchObject({
      event: { params: { delta: "first second" } },
    });
    const finished = buildThreadRows([
      ...stream,
      complete("first second FINAL"),
    ]);
    expect(finished).toHaveLength(1);
    expect(finished[0].key).toBe(running[0].key);
    expect(finished[0].item).toMatchObject({
      event: {
        method: "item/completed",
        params: { item: { text: "first second FINAL", phase: "final_answer" } },
      },
    });
  });

  it("retains warnings and independent items in their original order", () => {
    const warning = event("warning", { message: "keep me" });
    const rows = buildThreadRows([
      delta("one"),
      warning,
      delta("two", "turn", "other"),
      delta(" tail"),
      complete("full"),
    ]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(
      content([
        delta("one"),
        warning,
        delta("two", "turn", "other"),
        delta(" tail"),
        complete("full"),
      ])[1],
    ).toBe(warning);
  });

  it("scopes repeated native item ids to their owning thread and turn", () => {
    expect(
      content([
        delta("first", "one"),
        delta("second", "two"),
        complete("FIRST", "one"),
        complete("SECOND", "two"),
      ]),
    ).toMatchObject([
      { params: { turnId: "one", item: { text: "FIRST" } } },
      { params: { turnId: "two", item: { text: "SECOND" } } },
    ]);
  });

  it("does not append a replay or a late delta to a completed snapshot", () => {
    const snapshot = complete("complete");
    const rows = buildThreadRows([
      delta("part"),
      snapshot,
      snapshot,
      delta("late"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toMatchObject({
      event: { params: { item: { text: "complete" } } },
    });
  });

  it("projects plan deltas but accepts a different final plan as authoritative", () => {
    const params = { threadId: "thread", turnId: "turn", itemId: "plan" };
    const rows = buildThreadRows([
      event("item/plan/delta", { ...params, delta: "Draft" }),
      event("warning", { message: "keep" }),
      event("item/plan/delta", { ...params, delta: " plan" }),
      event("item/completed", {
        threadId: "thread",
        turnId: "turn",
        item: { type: "plan", id: "plan", text: "Final revised plan" },
      }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].item).toMatchObject({
      event: {
        method: "item/completed",
        params: { item: { text: "Final revised plan" } },
      },
    });
  });
  it("projects a nonempty plan start and its final snapshot as one stable native row", () => {
    const params = {threadId:"thread",turnId:"turn"};
    const started = event("item/started", {...params,item:{type:"plan",id:"plan",text:"Saved plan"}});
    const completed = event("item/completed", {...params,item:{type:"plan",id:"plan",text:"Final plan"}});
    const before = buildThreadRows([started]);
    const after = buildThreadRows([started,completed]);
    expect(after).toHaveLength(1);
    expect(after[0].key).toBe(before[0].key);
    expect(after[0].item).toMatchObject({kind:"event",event:completed});
  });

  it("keeps public summary parts while excluding raw reasoning content", () => {
    const params = { threadId: "thread", turnId: "turn", itemId: "summary" };
    const rows = buildThreadRows([
      event("item/reasoning/summaryTextDelta", {
        ...params,
        summaryIndex: 0,
        delta: "Checking",
      }),
      event("item/reasoning/textDelta", { ...params, delta: "RAW PRIVATE" }),
      event("item/reasoning/summaryTextDelta", {
        ...params,
        summaryIndex: 0,
        delta: " files",
      }),
      event("item/reasoning/summaryTextDelta", {
        ...params,
        summaryIndex: 1,
        delta: "Choosing tests",
      }),
      event("item/completed", {
        threadId: "thread",
        turnId: "turn",
        item: {
          type: "reasoning",
          id: "summary",
          summary: ["Checked files", "Selected tests"],
          content: ["RAW PRIVATE"],
        },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toMatchObject({
      event: {
        params: {
          item: { summary: ["Checked files", "Selected tests"], content: [] },
        },
      },
    });
    expect(JSON.stringify(rows)).not.toContain("RAW PRIVATE");
  });

  it("keeps final-only replies and prepended-history anchors", () => {
    const reply = complete("final only");
    const prior = complete("earlier", "earlier");
    expect(buildThreadRows([reply])).toHaveLength(1);
    expect(buildThreadRows([prior, reply]).at(-1)?.key).toBe(
      buildThreadRows([reply])[0].key,
    );
  });

  it("projects MCP start, progress and completion into one stable row", () => {
    const item = {
      type: "mcpToolCall",
      id: "call",
      server: "workspace",
      tool: "inspect",
      arguments: {},
      status: "inProgress",
      result: null,
    };
    const start = event("item/started", {
      threadId: "thread",
      turnId: "turn",
      item,
    });
    const progress = event("item/mcpToolCall/progress", {
      threadId: "thread",
      turnId: "turn",
      itemId: "call",
      message: "Reading file",
    });
    const running = buildThreadRows([start, progress]);
    expect(running).toHaveLength(1);
    expect(running[0].item).toMatchObject({
      event: {
        params: {
          item: { server: "workspace", progressMessage: "Reading file" },
        },
      },
    });
    const rows = buildThreadRows([
      start,
      progress,
      event("item/completed", {
        threadId: "thread",
        turnId: "turn",
        item: { ...item, status: "completed", result: { content: [] } },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(running[0].key);
    expect(rows[0].item).toMatchObject({
      event: { params: { item: { status: "completed" } } },
    });
  });

  it("shows live native search, image and compaction items once, then replaces their snapshots", () => {
    for (const item of [
      {
        type: "webSearch",
        id: "web",
        query: "codex docs",
        action: null,
        results: null,
      },
      {
        type: "imageGeneration",
        id: "image",
        status: "inProgress",
        result: "",
        revisedPrompt: null,
      },
      { type: "contextCompaction", id: "compact" },
      {
        type: "dynamicToolCall",
        id: "dynamic",
        namespace: "functions",
        tool: "inspect",
        status: "inProgress",
        arguments: {},
        contentItems: null,
        success: null,
        durationMs: null,
      },
    ]) {
      const start = event("item/started", {
        threadId: "thread",
        turnId: "turn",
        item,
      });
      const running = buildThreadRows([start]);
      expect(running).toHaveLength(1);
      const final = event("item/completed", {
        threadId: "thread",
        turnId: "turn",
        item: { ...item, status: "completed" },
      });
      const done = buildThreadRows([start, final, final]);
      expect(done).toHaveLength(1);
      expect(done[0].key).toBe(running[0].key);
      expect(done[0].item).toMatchObject({
        event: { method: "item/completed" },
      });
    }
  });

  it("terminal turns settle unfinished rows without inventing successful item results", () => {
    const start = event("item/started", {
      threadId: "thread",
      turnId: "turn",
      item: {
        type: "mcpToolCall",
        id: "call",
        status: "inProgress",
        server: "workspace",
        tool: "inspect",
        arguments: {},
        result: null,
      },
    });
    const rows = buildThreadRows([
      start,
      event("turn/completed", {
        threadId: "thread",
        turn: { id: "turn", status: "interrupted", items: [] },
      }),
    ]);
    expect(rows[0].context).toMatchObject({ renderTermination: "interrupted" });
    expect(rows[0].item).toMatchObject({
      event: { params: { item: { result: null, status: "inProgress" } } },
    });
    const partial = buildThreadRows([
      delta("partial"),
      event("turn/completed", {
        threadId: "thread",
        turn: {
          id: "turn",
          status: "failed",
          items: [],
          error: { message: "failed" },
        },
      }),
      delta("late"),
    ]);
    expect(partial[0].context).toMatchObject({ renderTermination: "failed" });
    expect(partial[0].item).toMatchObject({
      event: { params: { delta: "partial" } },
    });
  });

  it("uses the terminal turn's final item snapshot if its individual completion was missed", () => {
    const rows = buildThreadRows([
      delta("part"),
      event("turn/completed", {
        threadId: "thread",
        turn: {
          id: "turn",
          status: "completed",
          items: [
            {
              type: "agentMessage",
              id: "answer",
              text: "Final complete text",
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toMatchObject({
      event: {
        method: "item/completed",
        params: { item: { text: "Final complete text" } },
      },
    });
  });

  it("keeps only the latest checklist snapshot for each owning turn", () => {
    const plan = (turnId: string, text: string) =>
      event("turn/plan/updated", {
        threadId: "thread",
        turnId,
        explanation: null,
        plan: [{ step: text, status: "inProgress" }],
      });
    const rows = buildThreadRows([
      plan("one", "old"),
      plan("two", "other"),
      plan("one", "new"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].item).toMatchObject({
      event: { params: { plan: [{ step: "new" }] } },
    });
    expect(rows[1].item).toMatchObject({
      event: { params: { plan: [{ step: "other" }] } },
    });
  });
});
