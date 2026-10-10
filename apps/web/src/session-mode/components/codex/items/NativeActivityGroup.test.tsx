import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import type { ServerNotification } from "@session/bindings";
import { groupThreadActivities } from "../thread/activityRows";
import { buildThreadRows } from "../thread/threadRows";
import { RowStateContext } from "../thread/rowState";
import { NativeActivityGroup } from "./NativeActivityGroup";

vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "zh",
    interpolation: { escapeValue: false },
    resources: { zh: { thread: zh.thread } },
  });
});
const command = (id: string, status = "completed", type = "unknown") => ({
  method: "item/started",
  params: {
    threadId: "owner",
    turnId: "turn",
    startedAtMs: 1000,
    item: {
      type: "commandExecution",
      id,
      command: id,
      commandActions: [
        { type, command: id, name: `${id}.ts`, path: `/owner/${id}.ts` },
      ],
      status,
      cwd: "/owner",
      aggregatedOutput: "output",
      exitCode: status === "completed" ? 0 : null,
    },
  },
});
const mcp = (id: string) => ({
  method: "item/completed",
  params: {
    threadId: "owner",
    turnId: "turn",
    item: {
      type: "mcpToolCall",
      id,
      server: "fixture",
      tool: id,
      status: "completed",
      arguments: {},
      result: { content: [{ type: "text", text: `result-${id}` }] },
    },
  },
});
const group = (events: any[]) =>
  groupThreadActivities(
    buildThreadRows(events as ServerNotification[]),
    events as ServerNotification[],
  )[0].activity!;

const dynamic = (
  id: string,
  tool: string,
  namespace = "codex_app",
  status = "completed",
) => ({
  method: "item/completed",
  params: {
    threadId: "owner",
    turnId: "turn",
    item: {
      type: "dynamicToolCall",
      id,
      namespace,
      tool,
      status,
      arguments: {},
      contentItems: [],
    },
  },
});
const terminal = {
  method: "turn/completed",
  params: {
    threadId: "owner",
    turn: { id: "turn", status: "completed", items: [], error: null },
  },
};

it("completed dynamic summaries use native localized descriptions rather than raw identifiers", () => {
  const value = group([
    dynamic("read", "read_thread"),
    dynamic("create", "create_thread"),
    terminal,
  ]);
  const view = render(<NativeActivityGroup group={value} />);
  const label = view.container.querySelector(
    ".codex-native-activity-header .codex-command-summary-label",
  );
  expect(label?.textContent).toContain("已读取聊天");
  expect(label?.textContent).toContain("已创建聊天");
  expect(label?.textContent).not.toMatch(/read_thread|create_thread/);
});

it("same-name dynamic tools keep distinct namespaces and completion outcomes in the summary", () => {
  const value = group([
    dynamic("native", "read_thread"),
    dynamic("foreign", "read_thread", "custom_provider"),
    dynamic("failed", "read_thread", "codex_app", "failed"),
    terminal,
  ]);
  expect(value.parts.filter((part) => part.kind === "dynamic")).toHaveLength(3);
  const view = render(<NativeActivityGroup group={value} />);
  const label = view.container.querySelector(
    ".codex-native-activity-header .codex-command-summary-label",
  );
  expect(label?.textContent).toContain("已读取聊天");
  expect(label?.textContent).toMatch(/read thread/i);
});

it("uses the original first-party dynamic registry glyph only for its actual namespace", () => {
  const source = (namespace: string) => ({
    method: "item/started",
    params: {
      threadId: "owner",
      turnId: "turn",
      item: {
        type: "dynamicToolCall",
        id: "dynamic",
        namespace,
        tool: "read_thread",
        status: "inProgress",
        arguments: { threadId: "target" },
        contentItems: [],
      },
    },
  });
  const view = render(
    <NativeActivityGroup group={group([source("codex_app")])} />,
  );
  expect(
    view.container
      .querySelector(".codex-activity-icon path")
      ?.getAttribute("d"),
  ).toMatch(/^M13\.4746 8\.00037/);
  view.rerender(
    <NativeActivityGroup group={group([source("custom_provider")])} />,
  );
  expect(view.container.querySelector(".codex-activity-icon")).toBeNull();
});

it("renders original mixed summaries and lazily expands each own tool result", () => {
  const value = group([
    command("read", "completed", "read"),
    mcp("first"),
    mcp("second"),
    command("cmd"),
  ]);
  const view = render(<NativeActivityGroup group={value} />);
  expect(
    screen.getByRole("button", {
      name: "已使用 Fixture 集成读取文件运行了命令",
    }),
  ).toBeTruthy();
  expect(screen.queryByText("result-first")).toBeNull();
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByRole("link", { name: "read.ts" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "First" }));
  expect(screen.getByText("result-first")).toBeTruthy();
  expect(screen.queryByText("result-second")).toBeNull();
  expect(view.container.querySelectorAll(".codex-tool-call")).toHaveLength(2);
});
it("deduplicates the actual MCP integration source without hiding individual tool results", () => {
  const value = group([mcp("first"), mcp("second"), command("cmd")]);
  const view = render(<NativeActivityGroup group={value} />);
  const label = view.container.querySelector(
    ".codex-native-activity-header .codex-command-summary-label",
  );
  // Native Ue/gD presents mcp-sources, not a generic count of named calls.
  expect(label?.textContent).toBe("已使用 Fixture 集成运行了命令");
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByRole("button", { name: "First" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Second" })).toBeTruthy();
});
it("keeps native MCP and dynamic summary parts in their actual interleaved order", () => {
  const cloud = mcp("cloud");
  cloud.params.item.server = "codex_apps";
  cloud.params.item.tool = "cloud_threads.read";
  cloud.params.item.arguments = { chat_id: "target" };
  const value = group([
    dynamic("read", "read_thread"),
    cloud,
    dynamic("create", "create_thread"),
    terminal,
  ]);
  expect(value.parts.map((part) => part.kind)).toEqual([
    "dynamic",
    "mcpNative",
    "dynamic",
  ]);
  const view = render(<NativeActivityGroup group={value} />);
  expect(
    view.container.querySelector(
      ".codex-native-activity-header .codex-command-summary-label",
    )?.textContent,
  ).toBe("已读取聊天已读取云端聊天轮次已创建聊天");
});
it("updates an integration's display metadata while preserving its first order and preferred hint", () => {
  const first = mcp("first"),
    later = mcp("later");
  Object.assign(first.params.item, {
    appContext: { connectorId: "connector_docs", appName: "Docs" },
    pluginId: "fixture-plugin",
  });
  Object.assign(later.params.item, {
    appContext: { connectorId: "connector_docs", appName: "Updated Docs" },
  });
  const value = group([first, later, command("cmd")]);
  expect(value.parts[0]).toMatchObject({
    kind: "mcpSources",
    sources: [
      {
        key: "app:connector_docs",
        name: "Updated Docs",
        preferred: true,
        count: 2,
      },
    ],
  });
});
it("pending-only exploration has no clickable empty disclosure", () => {
  render(
    <NativeActivityGroup
      group={group([command("read", "inProgress", "read")])}
    />,
  );
  expect(
    screen
      .getAllByText("正在读取 read.ts")
      .filter((element) => !element.closest('[aria-hidden="true"]')),
  ).toHaveLength(1);
  expect(screen.queryByRole("button")).toBeNull();
});
it("uses the native folder-first active caption even when the search has a query", () => {
  const event = command("search", "inProgress", "search");
  event.params.item.commandActions = [
    { type: "search", command: "rg term", path: "./src", query: "term" },
  ] as any;
  render(<NativeActivityGroup group={group([event])} />);
  expect(
    screen
      .getAllByText("正在搜索 src 文件夹中的文件")
      .filter((el) => !el.closest('[aria-hidden="true"]')),
  ).toHaveLength(1);
  expect(screen.queryByText(/“term”/)).toBeNull();
});
it("uses the original skill and canonical knowledge glyphs rather than the ordinary read book", async () => {
  const make = (path: string) => {
    const event = command("read", "inProgress", "read");
    event.params.item.commandActions = [
      { type: "read", command: "cat", name: "SKILL.md", path },
    ] as any;
    return group([event]);
  };
  const view = render(
    <NativeActivityGroup
      group={make("/owner/.agents/skills/grill_me/SKILL.md")}
    />,
  );
  expect(
    view.container
      .querySelector(".codex-activity-icon path")
      ?.getAttribute("d"),
  ).toMatch(/^M13\.1892 6\.42285/);
  view.rerender(
    <NativeActivityGroup
      group={make("/owner/.codex/skills/.system/internal-knowledge/SKILL.md")}
    />,
  );
  await waitFor(
    () =>
      expect(
        view.container
          .querySelector(".codex-activity-icon path")
          ?.getAttribute("d"),
      ).toMatch(/^M3\.74709 9\.4286/),
    { timeout: 1500 },
  );
});
it("manual expansion persists from active through thinking and completed states and across remount", async () => {
  const cache = new Map<string, unknown>();
  const initial = group([
    command("read", "completed", "read"),
    command("cmd", "inProgress"),
  ]);
  const view = render(
    <RowStateContext.Provider value={cache}>
      <NativeActivityGroup group={initial} />
    </RowStateContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  const thinking = group([
    {
      method: "turn/started",
      params: {
        threadId: "owner",
        turn: { id: "turn", status: "inProgress", items: [] },
      },
    },
    command("read", "completed", "read"),
    command("cmd"),
  ]);
  view.rerender(
    <RowStateContext.Provider value={cache}>
      <NativeActivityGroup group={thinking} />
    </RowStateContext.Provider>,
  );
  expect(
    await screen.findByRole(
      "button",
      { name: "正在思考", expanded: true },
      { timeout: 2000 },
    ),
  ).toBeTruthy();
  const completed = group([
    command("read", "completed", "read"),
    command("cmd"),
  ]);
  view.unmount();
  render(
    <RowStateContext.Provider value={cache}>
      <NativeActivityGroup group={completed} />
    </RowStateContext.Provider>,
  );
  expect(
    screen.getByRole("button", {
      name: "已读取文件运行了命令",
      expanded: true,
    }),
  ).toBeTruthy();
});
it("keeps a live caption for the native one-second dwell, but completes immediately", () => {
  vi.useFakeTimers();
  try {
    const initial = group([command("first", "inProgress"), mcp("lookup")]);
    const view = render(<NativeActivityGroup group={initial} />);
    act(() => vi.advanceTimersByTime(250));
    const next = group([
      command("first"),
      mcp("lookup"),
      command("next", "inProgress"),
    ]);
    view.rerender(<NativeActivityGroup group={next} />);
    expect(screen.getByRole("button", { name: "正在运行 first" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(749));
    expect(screen.getByRole("button", { name: "正在运行 first" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("button", { name: "正在运行 next" })).toBeTruthy();
    view.rerender(
      <NativeActivityGroup
        group={group([command("first"), mcp("lookup"), command("next")])}
      />,
    );
    expect(
      screen.getByRole("button", { name: "已使用 Fixture 集成运行了命令" }),
    ).toBeTruthy();
    view.unmount();
    act(() => vi.runOnlyPendingTimers());
  } finally {
    vi.useRealTimers();
  }
});
it("preserves a group's reading offset through background updates and virtual remount", () => {
  const cache = new Map<string, unknown>();
  const value = group([command("one"), mcp("lookup")]);
  const wrap = (value: ReturnType<typeof group>) => (
    <RowStateContext.Provider value={cache}>
      <NativeActivityGroup group={value} />
    </RowStateContext.Provider>
  );
  const view = render(wrap(value));
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  const body = view.container.querySelector<HTMLElement>(
    ".codex-activity-body",
  )!;
  body.scrollTop = 160;
  fireEvent.scroll(body);
  view.rerender(wrap(group([command("one"), mcp("lookup"), command("two")])));
  expect(body.scrollTop).toBe(160);
  view.unmount();
  const restored = render(wrap(value));
  expect(
    restored.container.querySelector<HTMLElement>(".codex-activity-body")!
      .scrollTop,
  ).toBe(160);
  // An explicit close/open starts at the top, as in the original plugin.
  fireEvent.click(screen.getByRole("button", { expanded: true }));
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(
    restored.container.querySelector<HTMLElement>(".codex-activity-body")!
      .scrollTop,
  ).toBe(0);
});
