import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ThreadGoal } from "@session/bindings/v2";
const api = vi.hoisted(() => ({
  set: vi.fn(),
  clear: vi.fn(),
  read: vi.fn(),
  materialize: vi.fn(),
  uncertain: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@session/services/codexService", () => ({
  codexService: {
    threadGoalSet: api.set,
    threadGoalClear: api.clear,
    assertThreadGoalReady() {},
  },
}));
vi.mock("./goalMaterialization", () => ({
  readGoalObjective: api.read,
  materializeGoalDraft: api.materialize,
  isGoalSubmissionUncertain: api.uncertain,
}));
vi.mock("sonner", () => ({ toast: { error: api.error } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh-CN" } }),
}));
import { GoalDialog, ThreadGoalCard } from "./ThreadGoalCard";
import { useCodexStore } from "@session/components/codex/stores";
import { threadGoalVersions } from "@session/services/threadGoalState";
const goal: ThreadGoal = {
  threadId: "goal-a",
  objective: "可验收的原目标",
  status: "blocked",
  tokenBudget: 10000,
  tokensUsed: 2000,
  timeUsedSeconds: 61,
  createdAt: 1,
  updatedAt: 100,
};
const mount = (disabled = false) =>
  render(
    <div className="session-mode">
      <ThreadGoalCard goal={goal} disabled={disabled} />
    </div>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockImplementation(async (text: string) => text);
  api.materialize.mockImplementation(
    async ({ objective }: { objective: string }) => ({ objective }),
  );
  api.set.mockResolvedValue({ goal });
  api.clear.mockResolvedValue({ cleared: true });
  api.uncertain.mockReturnValue(true);
  useCodexStore.setState({ goalMap: { [goal.threadId]: goal } });
});

// Original Cu keeps Main.I3n's close enabled while its controlled onOpenChange
// refuses pending dismissal. Real Tab/pointer/ring parity belongs to the E2E.
it("keeps a busy GoalDialog close focusable without requesting dismissal", () => {
  const onClose = vi.fn();
  render(
    <div className="session-mode">
      <GoalDialog title="编辑目标" busy closeButton onClose={onClose}>
        <textarea aria-label="目标草稿" defaultValue="保存中的草稿" disabled />
      </GoalDialog>
    </div>,
  );
  const dialog = screen.getByRole("dialog");
  const close = within(dialog).getByRole("button", {
    name: "关闭对话框",
  }) as HTMLButtonElement;
  expect(close.disabled).toBe(false);
  act(() => close.focus());
  expect(document.activeElement).toBe(close);
  fireEvent.click(close);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "目标草稿",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("保存中的草稿");
});

it("uses the current busy state for GoalDialog close and permits idle dismissal", () => {
  const onClose = vi.fn();
  const contents = (busy: boolean) => (
    <div className="session-mode">
      <GoalDialog title="编辑目标" busy={busy} closeButton onClose={onClose}>
        <p>关闭操作不提交目标</p>
      </GoalDialog>
    </div>
  );
  const { rerender } = render(contents(false));
  const close = screen.getByRole("button", {
    name: "关闭对话框",
  }) as HTMLButtonElement;
  expect(close.disabled).toBe(false);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);

  onClose.mockClear();
  rerender(contents(true));
  const pendingClose = screen.getByRole("button", {
    name: "关闭对话框",
  }) as HTMLButtonElement;
  expect(pendingClose.disabled).toBe(false);
  fireEvent.click(pendingClose);
  expect(onClose).not.toHaveBeenCalled();

  rerender(contents(false));
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("disables concurrent controls and sends only the captured goal once", async () => {
  let release!: () => void;
  api.set.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "恢复目标" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复目标" }));
  expect(api.set).toHaveBeenCalledExactlyOnceWith({
    threadId: "goal-a",
    status: "active",
  });
  for (const button of screen.getAllByRole("button"))
    expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release());
});

it("keeps the original goal and reports a failed clear", async () => {
  api.clear.mockRejectedValueOnce(new Error("isolated rejection"));
  mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "清除目标" })),
  );
  expect(useCodexStore.getState().goalMap[goal.threadId]).toEqual(goal);
  expect(api.error).toHaveBeenCalledWith("无法清除目标", {
    description: "isolated rejection",
  });
});

it("lets a read-only observer inspect the goal but cannot mutate it", async () => {
  mount(true);
  expect(
    (screen.getByRole("button", { name: "恢复目标" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "清除目标" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "编辑目标" })),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "目标" }), {
    target: { value: "观察者的草稿" },
  });
  expect(
    (within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.submit(dialog.querySelector("form")!);
  expect(api.set).not.toHaveBeenCalled();
});

it("saves changed text with native Ctrl/Cmd+S and never changes the budget", async () => {
  mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "编辑目标" })),
  );
  const editor = screen.getByRole("textbox", { name: "目标" });
  fireEvent.change(editor, { target: { value: "  新目标  " } });
  await act(async () => fireEvent.keyDown(editor, { key: "s", ctrlKey: true }));
  expect(api.set).toHaveBeenCalledExactlyOnceWith({
    threadId: "goal-a",
    objective: "新目标",
    status: "active",
  });
});

it("preserves editor text on failure and rejects a newer objective before saving", async () => {
  mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "编辑目标" })),
  );
  const editor = screen.getByRole("textbox", { name: "目标" });
  fireEvent.change(editor, { target: { value: "本设备未发送的修改" } });
  act(() =>
    useCodexStore
      .getState()
      .setGoal(goal.threadId, { ...goal, objective: "另一设备的已保存目标" }),
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "保存" })),
  );
  expect(api.set).not.toHaveBeenCalled();
  expect((editor as HTMLTextAreaElement).value).toBe("本设备未发送的修改");
  expect(api.error).toHaveBeenCalled();
});

it("does not send prepared edits to a replacement runtime with the same thread and objective", async () => {
  let release!: (value: { objective: string }) => void;
  api.materialize.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "编辑目标" })),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "目标" }), {
    target: { value: "原连接的未发送编辑" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  act(() => threadGoalVersions.reset());
  await act(async () => release({ objective: "原连接的未发送编辑" }));
  expect(api.set).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("textbox", { name: "目标" }) as HTMLTextAreaElement)
      .value,
  ).toBe("原连接的未发送编辑");
});

it("does not submit the surrounding composer when saving the portaled editor", async () => {
  const submitComposer = vi.fn((event: React.FormEvent) =>
    event.preventDefault(),
  );
  render(
    <div className="session-mode">
      <form onSubmit={submitComposer}>
        <ThreadGoalCard goal={goal} />
      </form>
    </div>,
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "编辑目标" })),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "目标" }), {
    target: { value: "只编辑保存的目标" },
  });
  await act(async () => fireEvent.submit(dialog.querySelector("form")!));
  expect(api.set).toHaveBeenCalledExactlyOnceWith({
    threadId: "goal-a",
    objective: "只编辑保存的目标",
    status: "active",
  });
  expect(submitComposer).not.toHaveBeenCalled();
});

it("reports rejected-attachment cleanup failures with a retry bound to those files", async () => {
  const cleanup = vi
    .fn()
    .mockRejectedValueOnce(new Error("cleanup offline"))
    .mockResolvedValue(undefined);
  api.materialize.mockResolvedValue({ objective: "目标文件引用", cleanup });
  api.uncertain.mockReturnValue(false);
  api.set.mockRejectedValueOnce(new Error("definite rejection"));
  mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "编辑目标" })),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "目标" }), {
    target: { value: "新的文件目标" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "保存" })),
  );
  expect(cleanup).toHaveBeenCalledTimes(1);
  const failedCleanup = api.error.mock.calls.find(
    ([message]) => message === "目标附件暂未清理",
  );
  expect(failedCleanup).toBeDefined();
  const action = failedCleanup![1].action;
  expect(action.label).toBe("重试清理");
  await act(async () => action.onClick());
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(api.set).toHaveBeenCalledTimes(1);
});
