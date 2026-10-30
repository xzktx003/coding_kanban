import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ServerNotification } from "@session/bindings";
import type { ThreadItem } from "@session/bindings/v2";
import { markCachedTurnExecutionUnverified } from "@session/services/cachedTurnExecutionView";
import { buildThreadRows } from "../thread/threadRows";
import { EventItem } from "./EventItem";
import { groupThreadActivities } from "../thread/activityRows";
import { ShellCommand } from "./ShellCommand";

vi.mock("./ThreadFileChangesSummary", () => ({
  ThreadFileChangesSummary: () => <div>文件改动仍保留</div>,
}));

const terminal = (
  id: string,
  items: ThreadItem[] = [],
): ServerNotification => ({
  method: "turn/completed",
  params: {
    threadId: "owner",
    turn: {
      id,
      status: "interrupted",
      items,
      itemsView: "full",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1000,
    },
  },
});

function renderRows(events: ServerNotification[]) {
  return render(
    <>
      {buildThreadRows(events).map((row) =>
        row.item.kind === "event" ? (
          <EventItem
            key={row.key}
            event={row.item.event}
            context={row.context}
          />
        ) : null,
      )}
    </>,
  );
}

it("keeps an unverified cached ending neutral without changing the native status", () => {
  const event = terminal("cached");
  markCachedTurnExecutionUnverified(event);
  renderRows([event]);
  expect(screen.getByRole("status").textContent).toBe("正在核对轮次状态");
  expect(screen.queryByLabelText("该轮已中断")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(event).toMatchObject({ params: { turn: { status: "interrupted" } } });
});

it("keeps true older interruptions and file changes while checking only the marked latest turn", () => {
  const cached = terminal("cached", [
    {
      type: "fileChange",
      id: "file",
      status: "completed",
      changes: [{ path: "file.ts", kind: { type: "add" }, diff: "+test" }],
    },
  ]);
  markCachedTurnExecutionUnverified(cached);
  renderRows([terminal("old"), cached]);
  expect(screen.getAllByLabelText("该轮已中断")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toBe("正在核对轮次状态");
  expect(screen.getByText("文件改动仍保留")).toBeTruthy();
});

it("replaces neutral uncertainty with fresh exact-turn confirmation", () => {
  const cached = terminal("cached");
  markCachedTurnExecutionUnverified(cached);
  const view = renderRows([cached]);
  view.unmount();
  renderRows([cached, terminal("cached")]);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByLabelText("该轮已中断")).toBeTruthy();
});

const command: ThreadItem = {
  type: "commandExecution",
  id: "command",
  pluginId: null,
  scriptPath: null,
  command: "echo partial",
  cwd: "/owner",
  processId: null,
  source: "agent",
  status: "inProgress",
  commandActions: [],
  aggregatedOutput: "partial",
  exitCode: null,
  durationMs: null,
};
const tool: ThreadItem = {
  type: "mcpToolCall",
  id: "tool",
  server: "fixture",
  tool: "lookup",
  status: "inProgress",
  arguments: {},
  appContext: null,
  pluginId: null,
  result: null,
  error: null,
  durationMs: null,
};
const started = (item: ThreadItem): ServerNotification => ({
  method: "item/started",
  params: { threadId: "owner", turnId: "cached", startedAtMs: 1000, item },
});

it("keeps unfinished command and MCP projections neutral through activity regrouping", () => {
  const cached = terminal("cached");
  markCachedTurnExecutionUnverified(cached);
  const events = [started(command), started(tool), cached];
  const projected = groupThreadActivities(buildThreadRows(events), events);
  const entries = projected.flatMap(
    (row) =>
      row.activity?.entries ?? (row.activityEntry ? [row.activityEntry] : []),
  );
  const commandEntry = entries.find((entry) => entry.kind === "command");
  const toolEntry = entries.find((entry) => entry.kind === "event");
  if (commandEntry?.kind !== "command" || toolEntry?.kind !== "event")
    throw new Error("missing original tool rows");
  expect(commandEntry.source.termination).toBe("unverified");
  expect(commandEntry.source.status).toBe("inProgress");
  expect(commandEntry.source.exitCode).toBeNull();
  expect(toolEntry.row.context?.renderTermination).toBe("unverified");
  expect(entries.every((entry) => !entry.pending)).toBe(true);
  render(
    <>
      <ShellCommand command="echo partial" {...commandEntry.source} />
      <EventItem event={started(tool)} context={toolEntry.row.context} />
    </>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "正在核对轮次状态 · fixture.lookup" }),
  );
  expect(screen.getAllByText(/正在核对轮次状态/).length).toBeGreaterThan(0);
  expect(
    screen.queryByText(/已中断|已停止|已结束|工具未返回任何内容/),
  ).toBeNull();
});

it("keeps an explicit native tool failure under an unverified cached turn", () => {
  const failed: ThreadItem = {
    ...tool,
    status: "failed",
    error: { message: "native tool rejected" },
  };
  const cached = terminal("cached", [failed]);
  markCachedTurnExecutionUnverified(cached);
  renderRows([started(tool), cached]);
  fireEvent.click(screen.getByRole("button", { name: "Lookup" }));
  expect(screen.getByRole("alert").textContent).toBe("native tool rejected");
  expect(screen.getByRole("status").textContent).toBe("正在核对轮次状态");
});

it("reconciles an unfinished command when a fresh exact-turn ending follows its cached uncertainty", () => {
  const cached = terminal("cached");
  markCachedTurnExecutionUnverified(cached);
  const rows = buildThreadRows([started(command), cached, terminal("cached")]);
  const group = rows.find((row) => row.item.kind === "cmdGroup");
  expect(group?.item).toMatchObject({
    actionSources: [
      { termination: "interrupted", status: "inProgress", exitCode: null },
    ],
  });
});

for (const item of [
  { type: "contextCompaction", id: "compaction" },
  { type: "webSearch", id: "search", query: "query", action: null, results: null },
  { type: "imageGeneration", id: "image", status: "inProgress", revisedPrompt: null, result: "" },
] satisfies ThreadItem[]) {
  it(`does not claim ${item.type} finished or keep it spinning from a cached uncertain ending`, () => {
    const cached = terminal("cached");
    markCachedTurnExecutionUnverified(cached);
    const { container } = renderRows([started(item), cached]);
    expect(screen.getAllByText("正在核对轮次状态")).toHaveLength(2);
    expect(container.querySelector(".animate-spin,.codex-cadenced-shimmer")).toBeNull();
    expect(screen.queryByLabelText("该轮已中断")).toBeNull();
  });
}
