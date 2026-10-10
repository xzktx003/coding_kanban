import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { CloudTasksPanel } from "./CloudTasksPanel";
import { useVsCodePanelStore } from "@session/stores/useVsCodePanelStore";
const owner = { cwd: "/project", threadId: "thread-a", draftOwner: "draft-a" };
beforeEach(() => vi.restoreAllMocks());
test("cloud account missing displays its actual recovery reason and disables remote mutations", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        configured: false,
        available: false,
        identity: null,
        reason: "当前 API Key 不能提供云任务",
        recovery: "codex login 后刷新",
        plan: null,
      }),
    ),
  );
  render(<CloudTasksPanel owner={owner} />);
  expect(await screen.findByText("当前 API Key 不能提供云任务")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "创建云任务" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText("codex login 后刷新")).toBeTruthy();
});
test("late canonical directory resolution preserves the literal session cloud draft", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        configured: false,
        available: false,
        identity: null,
        reason: "登录缺失",
        recovery: "刷新",
        plan: null,
      }),
    ),
  );
  const aliasOwner = {
    cwd: "/alias-project",
    threadId: "alias-thread",
    draftOwner: "alias-draft",
  };
  const view = render(<CloudTasksPanel owner={aliasOwner} />);
  fireEvent.change(screen.getByRole("textbox", { name: "云任务消息" }), {
    target: { value: "keep captured alias draft" },
  });
  useVsCodePanelStore.setState({
    aliases: { "/alias-project": "/canonical-project" },
  });
  view.rerender(<CloudTasksPanel owner={aliasOwner} />);
  expect(
    (screen.getByRole("textbox", { name: "云任务消息" }) as HTMLTextAreaElement)
      .value,
  ).toBe("keep captured alias draft");
});
test("cloud form text stays isolated when owner changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        configured: false,
        available: false,
        identity: null,
        reason: "登录缺失",
        recovery: "刷新",
        plan: null,
      }),
    ),
  );
  const view = render(<CloudTasksPanel owner={owner} />);
  fireEvent.change(screen.getByRole("textbox", { name: "云任务消息" }), {
    target: { value: "draft for a" },
  });
  view.rerender(
    <CloudTasksPanel
      owner={{ ...owner, draftOwner: "draft-b", threadId: "thread-b" }}
    />,
  );
  expect(
    (screen.getByRole("textbox", { name: "云任务消息" }) as HTMLTextAreaElement)
      .value,
  ).toBe("");
  view.rerender(<CloudTasksPanel owner={owner} />);
  expect(
    (screen.getByRole("textbox", { name: "云任务消息" }) as HTMLTextAreaElement)
      .value,
  ).toBe("draft for a");
});
