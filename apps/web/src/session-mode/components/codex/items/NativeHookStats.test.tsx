import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeHookStats } from "./NativeHookStats";
const locale = vi.hoisted(() => ({ language: "zh" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (key: string) => key }),
}));
afterEach(() => {
  locale.language = "zh";
});
it("shows real blocked hook entries with owner-bound statistics and no implicit actions", () => {
  render(
    <NativeHookStats
      runs={
        [
          {
            id: "hook",
            eventName: "userPromptSubmit",
            source: "project",
            status: "blocked",
            statusMessage: "Project policy",
            entries: [{ kind: "stop", text: "Need task scope" }],
            displayOrder: 2n,
          },
        ] as never
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "钩子统计信息" }));
  expect(screen.getByRole("dialog").textContent).toContain("运行次数");
  fireEvent.click(screen.getByText("已阻止", { selector: "summary span" }));
  expect(screen.getByText("Need task scope")).toBeTruthy();
  expect(screen.getByRole("dialog").querySelectorAll("button")).toHaveLength(1);
});
it("excludes unfinished invocations and raw context from native completed-turn statistics", () => {
  const running = {
    id: "live",
    eventName: "postToolUse",
    source: "project",
    status: "running",
    entries: [],
  };
  const { rerender } = render(<NativeHookStats runs={[running] as never} />);
  expect(screen.queryByRole("button", { name: "钩子统计信息" })).toBeNull();
  rerender(
    <NativeHookStats
      runs={
        [
          running,
          {
            id: "done",
            eventName: "postToolUse",
            source: "system",
            status: "completed",
            entries: [
              { kind: "context", text: "Internal context" },
              { kind: "warning", text: "Public hook message" },
            ],
          },
        ] as never
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "钩子统计信息" }));
  fireEvent.click(screen.getByRole("dialog").querySelector("summary")!);
  expect(screen.getByText("Public hook message")).toBeTruthy();
  expect(screen.queryByText("Internal context")).toBeNull();
  expect(screen.getByText("管理员")).toBeTruthy();
  expect(screen.getByRole("dialog").querySelectorAll("li")).toHaveLength(1);
});
it("focuses the native close action and restores the Hook trigger after closing", async () => {
  render(
    <NativeHookStats
      runs={
        [
          {
            id: "done",
            eventName: "stop",
            source: "project",
            status: "completed",
            entries: [],
          },
        ] as never
      }
    />,
  );
  const trigger = screen.getByRole("button", { name: "钩子统计信息" });
  trigger.focus();
  fireEvent.click(trigger);
  const close = screen.getByRole("button", { name: "关闭对话框" });
  expect(document.activeElement).toBe(close);
  fireEvent.click(close);
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
it.each([
  ["zh", "blocked", "钩子未提供原因"],
  ["zh", "failed", "钩子未提供错误详情"],
  ["zh", "stopped", "钩子未提供停止原因"],
  ["en", "blocked", "The hook did not provide a reason"],
  ["en", "failed", "The hook did not provide error details"],
  ["en", "stopped", "The hook did not provide a stop reason"],
])(
  "uses the native public no-output message for %s / %s",
  (language, status, message) => {
    locale.language = language;
    render(
      <NativeHookStats
        runs={
          [
            {
              id: "terminal",
              eventName: "stop",
              source: "project",
              status,
              entries: [],
            },
          ] as never
        }
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: language === "zh" ? "钩子统计信息" : "Hook stats",
      }),
    );
    fireEvent.click(screen.getByRole("dialog").querySelector("summary")!);
    expect(screen.getByText(message)).toBeTruthy();
  },
);
