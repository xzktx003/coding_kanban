import { describe, expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildThreadRows } from "./threadRows";

const event = (method: string, item: object): ServerNotification =>
  ({
    method,
    params: {
      threadId: "owner-A",
      turnId: "turn-A",
      item,
      startedAtMs: 1,
      completedAtMs: 2,
    },
  }) as ServerNotification;
const reply = (id: string) =>
  event("item/completed", {
    id,
    type: "agentMessage",
    text: id,
    phase: "commentary",
    memoryCitation: null,
  });

describe("visible transcript row spacing boundaries", () => {
  for (const type of ["reasoning", "plan"] as const) {
    it(`keeps empty ${type} lifecycle records out of padded visible rows`, () => {
      const item =
        type === "reasoning"
          ? { id: "empty", type, summary: [], content: [] }
          : { id: "empty", type, text: "" };
      const events = [
        reply("before"),
        event("item/started", item),
        event("item/completed", item),
        reply("after"),
      ];
      const original = structuredClone(events);
      const rows = buildThreadRows(events);
      expect(rows.map((row) => row.key)).toEqual([
        "event-turn-A-before",
        "event-turn-A-after",
      ]);
      expect(events).toHaveLength(4);
      expect(events).toEqual(original);
    });
    it(`retains the original identity when initially empty ${type} gets public content`, () => {
      const item =
        type === "reasoning"
          ? { id: "visible", type, summary: [], content: [] }
          : { id: "visible", type, text: "" };
      const completed =
        type === "reasoning"
          ? { ...item, summary: ["public summary"] }
          : { ...item, text: "public plan" };
      const rows = buildThreadRows([
        reply("before"),
        event("item/started", item),
        event("item/completed", completed),
        reply("after"),
      ]);
      expect(rows.map((row) => row.key)).toEqual([
        "event-turn-A-before",
        "event-turn-A-visible",
        "event-turn-A-after",
      ]);
      expect(rows[1].item).toMatchObject({
        kind: "event",
        event: { method: "item/completed", params: { item: completed } },
      });
    });
  }
});

it("reveals public summary deltas after an empty start once per captured identity", () => {
  const start = event("item/started", {
    id: "reason",
    type: "reasoning",
    summary: [],
    content: [],
  });
  const delta = {
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "owner-A",
      turnId: "turn-A",
      itemId: "reason",
      summaryIndex: 0,
      delta: "public summary",
    },
  } as ServerNotification;
  const done = event("item/completed", {
    id: "reason",
    type: "reasoning",
    summary: ["public summary"],
    content: ["PRIVATE RAW CONTENT"],
  });
  const before = buildThreadRows([start, delta]);
  const after = buildThreadRows([start, delta, done]);
  expect(before.map((row) => row.key)).toEqual(["event-turn-A-reason"]);
  expect(after.map((row) => row.key)).toEqual(before.map((row) => row.key));
  expect(JSON.stringify(after)).not.toContain("PRIVATE RAW CONTENT");
});
it("reveals plan deltas after empty starts without a completed duplicate or ghost row", () => {
  const start = event("item/started", { id: "plan", type: "plan", text: "" });
  const delta = {
    method: "item/plan/delta",
    params: {
      threadId: "owner-A",
      turnId: "turn-A",
      itemId: "plan",
      delta: "public plan",
    },
  } as ServerNotification;
  const done = event("item/completed", {
    id: "plan",
    type: "plan",
    text: "revised plan",
  });
  const before = buildThreadRows([start, delta]);
  const after = buildThreadRows([start, delta, done]);
  expect(before.map((row) => row.key)).toEqual(["event-turn-A-plan"]);
  expect(after.map((row) => row.key)).toEqual(before.map((row) => row.key));
  expect(after[0].item).toMatchObject({
    kind: "event",
    event: {
      method: "item/completed",
      params: { item: { text: "revised plan" } },
    },
  });
});
it("does not allocate a row for an empty plan delta", () => {
  expect(
    buildThreadRows([
      {
        method: "item/plan/delta",
        params: {
          threadId: "owner-A",
          turnId: "turn-A",
          itemId: "plan",
          delta: "",
        },
      } as ServerNotification,
    ]),
  ).toEqual([]);
});

it("keeps intentionally hidden completed sleep out of padded rows", () => {
  const sleep = { id: "sleep", type: "sleep", durationMs: 1 };
  const events = [
    reply("before"),
    event("item/started", sleep),
    event("item/completed", sleep),
    reply("after"),
  ];
  const original = structuredClone(events);
  expect(buildThreadRows(events).map((row) => row.key)).toEqual([
    "event-turn-A-before",
    "event-turn-A-after",
  ]);
  expect(events).toEqual(original);
});
it("does not allocate duplicate padded rows for an empty hook prompt lifecycle", () => {
  const hook = {
    id: "hook",
    type: "hookPrompt",
    fragments: [{ hookRunId: "native-hook", text: "" }],
  };
  const events = [
    reply("before"),
    event("item/started", hook),
    event("item/completed", hook),
    reply("after"),
  ];
  const original = structuredClone(events);
  expect(buildThreadRows(events).map((row) => row.key)).toEqual([
    "event-turn-A-before",
    "event-turn-A-after",
  ]);
  expect(events).toEqual(original);
});
it("retains a pending and completed nonempty hook prompt and its native hook reference", () => {
  const hook = {
    id: "hook",
    type: "hookPrompt",
    fragments: [{ hookRunId: "native-hook", text: "native public feedback" }],
  };
  const pending = buildThreadRows([event("item/started", hook)]);
  const completed = buildThreadRows([event("item/completed", hook)]);
  expect(pending).toHaveLength(1);
  expect(completed.map((row) => row.key)).toEqual(
    pending.map((row) => row.key),
  );
  expect(completed[0].item).toMatchObject({
    kind: "event",
    event: { params: { item: hook } },
  });
});
