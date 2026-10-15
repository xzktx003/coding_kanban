import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import { CommandActionItem } from "./CommandActionItem";
import type { CommandAction } from "@session/bindings/v2";

vi.mock("@session/lib/eventStream", () => ({
  openEventStream: vi.fn(() => () => {}),
}));
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: "zh", resources: { zh: { thread: zh.thread } } });
});
let fetchDetail: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchDetail = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          threadId: "thread",
          turnId: "turn",
          itemId: "item",
          item: {
            type: "commandExecution",
            id: "item",
            command: "original full command",
            cwd: "/fixture",
            status: "completed",
            aggregatedOutput: "READ_OUTPUT",
            exitCode: 0,
            durationMs: 12,
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchDetail);
});
afterEach(() => vi.unstubAllGlobals());
const actions: CommandAction[] = [
  { type: "read", command: "cat a.ts", name: "a.ts", path: "/fixture/a.ts" },
  { type: "search", command: "rg target", query: "target", path: "/fixture" },
  { type: "listFiles", command: "ls /fixture", path: "/fixture" },
];
it.each(actions)(
  "$type keeps its summary and loads only the explicitly selected output",
  async (action) => {
    const view = render(
      <CommandActionItem
        action={action}
        commandItemId="item"
        threadId="thread"
        turnId="turn"
        cwd="/fixture"
        status="completed"
        aggregatedOutput={null}
        exitCode={0}
        transcriptMetadataOnly
      />,
    );
    expect(screen.queryByText("详情未加载")).toBeNull();
    expect(fetchDetail).not.toHaveBeenCalled();
    if (action.type === "read")
      expect(screen.getByRole("link", { name: "a.ts" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "查看命令输出" });
    fireEvent.click(toggle);
    await screen.findByText("READ_OUTPUT");
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchDetail.mock.calls[0][1].body)).toEqual({
      threadId: "thread",
      turnId: "turn",
      itemId: "item",
      expectedType: "commandExecution",
    });
    fireEvent.click(screen.getByRole("button", { name: "收起命令输出" }));
    await waitFor(() =>
      expect(view.container.textContent).not.toContain("READ_OUTPUT"),
    );
    expect(screen.queryByText("详情未加载")).toBeNull();
  },
);
