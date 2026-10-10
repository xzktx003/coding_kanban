import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import { CommandActionSummaryItem } from "./CommandActionSummaryItem";
import { RowStateContext } from "../thread/rowState";
import type { CommandActionSource } from "../thread/deriveRenderItems";

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: "zh", resources: { zh: { thread: zh.thread } } });
});
const actions = [
  { type: "read" as const, name: "a.ts", path: "/a/a.ts", command: "cat a.ts" },
  { type: "search" as const, query: "foo", path: "/a", command: "rg foo" },
];
const source = (id: string, status = "completed"): CommandActionSource => ({
  threadId: "a",
  turnId: "turn",
  commandItemId: id,
  cwd: "/a",
  status,
  aggregatedOutput: null,
});

it("unwraps a single completed read without a redundant aggregate disclosure", () => {
  render(
    <CommandActionSummaryItem
      completed
      actions={actions.slice(0, 1)}
      actionSources={[source("read")]}
    />,
  );
  expect(screen.getByRole("link", { name: "a.ts" })).toBeTruthy();
  expect(screen.queryByRole("button", { expanded: false })).toBeNull();
});
it("keeps the single pending exploration visible in its active header", () => {
  render(
    <CommandActionSummaryItem
      completed={false}
      actions={actions.slice(0, 1)}
      actionSources={[source("read", "inProgress")]}
    />,
  );
  expect(screen.getByText("正在读取 a.ts")).toBeTruthy();
});
it("uses the original exploration summary and retains disclosure across virtual remounts", () => {
  const cache = new Map<string, unknown>();
  const body = (
    <RowStateContext.Provider value={cache}>
      <CommandActionSummaryItem
        completed
        actions={actions}
        actionSources={[source("read"), source("search")]}
      />
    </RowStateContext.Provider>
  );
  const view = render(body);
  expect(screen.getByRole("button", { name: "已读取文件" })).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "已读取文件" }));
  expect(screen.getByRole("link", { name: "a.ts" })).toBeTruthy();
  view.unmount();
  render(body);
  expect(
    screen.getByRole("button", { name: "已读取文件", expanded: true }),
  ).toBeTruthy();
});
it("shows the real pending search in the active header rather than completed counts", () => {
  render(
    <CommandActionSummaryItem
      completed={false}
      actions={actions}
      actionSources={[source("read"), source("search", "inProgress")]}
    />,
  );
  expect(
    screen.getByRole("button", { name: "正在 /a 中搜索“foo”" }),
  ).toBeTruthy();
  expect(screen.queryByText(/执行了|搜索了.*次/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByRole("link", { name: "a.ts" })).toBeTruthy();
  expect(document.querySelector('[data-command-action="search"]')).toBeNull();
});
it("a closed slice does not turn an unfinished command into a completed action", () => {
  render(
    <CommandActionSummaryItem
      completed
      actions={[...actions, { type: "unknown", command: "long-task" }]}
      actionSources={[
        source("read"),
        source("search"),
        source("command", "inProgress"),
      ]}
    />,
  );
  expect(
    screen.getByRole("button", { name: "正在运行 long-task" }),
  ).toBeTruthy();
  expect(screen.queryByText(/运行了命令/)).toBeNull();
});
