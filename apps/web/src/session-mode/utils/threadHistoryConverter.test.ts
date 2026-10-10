import { expect, it } from "vitest";
import type { Thread } from "@session/bindings/v2";
import { convertThreadHistoryToEvents } from "./threadHistoryConverter";
import { projectNativeHookRuns } from "../components/codex/presentation/nativeHookRuns";
const run = {
  id: "hook",
  eventName: "postToolUse",
  handlerType: "command",
  executionMode: "sync",
  scope: "turn",
  sourcePath: "/project/hooks.json",
  source: "project",
  displayOrder: "9007199254740994",
  status: "blocked",
  statusMessage: "Policy",
  startedAt: "9007199254740995",
  completedAt: "9007199254740996",
  durationMs: 1,
  entries: [{ kind: "feedback", text: "Actual output" }],
};
const history = (extra: object = {}) =>
  ({
    id: "owner",
    turns: [
      {
        id: "turn",
        items: [],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        ...extra,
      },
    ],
  }) as unknown as Thread;
it("restores only actual turn hookRuns metadata with exact bigint counters and owner identity", () => {
  const events = convertThreadHistoryToEvents(
    history({
      hookRuns: [
        run,
        {
          ...run,
          id: "running",
          status: "running",
          completedAt: null,
          durationMs: null,
        },
      ],
    }),
  );
  expect(
    events.filter((event) => event.method.startsWith("hook/")),
  ).toHaveLength(2);
  const runs = projectNativeHookRuns(events).get('["owner","turn"]')!;
  expect(runs[0]).toMatchObject({
    id: "hook",
    displayOrder: 9007199254740994n,
    startedAt: 9007199254740995n,
    status: "blocked",
    entries: [{ kind: "feedback", text: "Actual output" }],
  });
  expect(
    events.find((event) => event.method === "hook/started")?.params,
  ).toMatchObject({ threadId: "owner", turnId: "turn" });
});
it("does not invent runs from tools and rejects malformed actual hook metadata", () => {
  expect(
    convertThreadHistoryToEvents(history()).filter((event) =>
      event.method.startsWith("hook/"),
    ),
  ).toEqual([]);
  const events = convertThreadHistoryToEvents(
    history({
      hookRuns: [
        { ...run, id: "", status: "success" },
        { ...run, startedAt: Number.MAX_SAFE_INTEGER + 1 },
        { ...run, entries: [{ kind: "secret", text: "invalid" }] },
      ],
    }),
  );
  expect(events.filter((event) => event.method.startsWith("hook/"))).toEqual(
    [],
  );
});
