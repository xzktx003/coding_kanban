import { act } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { resetConversationFormDraftsForTests } from "./conversationFormDrafts";
import { ConversationMenu } from "./ConversationMenu";
import { useCodexStore } from "../stores/useCodexStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import { invalidateCodexOperationScope } from "@session/services/codexOperationScope";
const api = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  deleteThread: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitBranchInfo: vi.fn(),
  renameSession: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  ...api,
  threadAccess: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/git", () => api);
vi.mock("@session/services/sessionNames", () => ({
  renameSession: api.renameSession,
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "fixture",
    reasoningEffort: "medium",
  }),
}));
vi.mock("sonner", () => ({
  toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: vi.fn() },
}));
beforeEach(() => {
  resetConversationFormDraftsForTests();
  vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockResolvedValue({});
  api.gitBranchInfo.mockImplementation(async (cwd: string) => ({
    owner: "fixture",
    repo: cwd.endsWith("a") ? "repo-a" : "repo-b",
    branch: cwd.endsWith("a") ? "branch-a" : "branch-b",
    isDetached: false,
  }));
  useLayoutStore.setState({ view: "settings" });
  useCodexStore.setState({
    currentThreadId: "form-a",
    threads: [
      { id: "form-a", name: "Form A", cwd: "/fixture/a" },
      { id: "form-b", name: "Form B", cwd: "/fixture/b" },
    ] as never,
  });
  useSessionDraftStore.setState({
    drafts: {
      [sessionDraftKey("codex", "form-a")]: { text: "DRAFT-A", revision: 1 },
      [sessionDraftKey("codex", "form-b")]: { text: "DRAFT-B", revision: 1 },
    },
  });
});
function mount() {
  const node = (id: string) => (
    <div className="session-mode">
      <ConversationMenu
        threadId={id}
        title={id === "form-a" ? "Form A" : "Form B"}
      />
    </div>
  );
  const view = render(node("form-a"));
  return {
    ...view,
    switchTo(id: string) {
      act(() => useCodexStore.setState({ currentThreadId: id }));
      view.rerender(node(id));
    },
  };
}
async function open(label: string) {
  fireEvent.keyDown(
    screen.getByRole("button", { name: "当前会话的更多操作" }),
    { key: "ArrowDown" },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: label }));
  await screen.findByRole("dialog");
}
it.each([
  ["归档聊天", "确认归档", "archiveThread"],
  ["删除聊天", "删除", "deleteThread"],
] as const)(
  "keeps %s bound to the opening thread after another thread is selected",
  async (label, confirm, method) => {
    const v = mount();
    await open(label);
    v.switchTo("form-b");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: confirm }),
    );
    await waitFor(() => expect(api[method]).toHaveBeenCalledWith("form-a"));
  },
);
it("keeps an open note attached to A when B becomes current", async () => {
  const v = mount();
  await open("会议：记笔记");
  fireEvent.change(screen.getByLabelText("会议笔记"), {
    target: { value: "NOTE-A" },
  });
  v.switchTo("form-b");
  fireEvent.click(screen.getByRole("button", { name: "记入当前输入" }));
  expect(
    useSessionDraftStore.getState().drafts[sessionDraftKey("codex", "form-a")]
      .text,
  ).toBe("DRAFT-A\nNOTE-A");
  expect(
    useSessionDraftStore.getState().drafts[sessionDraftKey("codex", "form-b")]
      .text,
  ).toBe("DRAFT-B");
});
it("isolates cancelled notes by owner and restores A without discarding its buffer", async () => {
  const v = mount();
  await open("会议：记笔记");
  fireEvent.change(screen.getByLabelText("会议笔记"), {
    target: { value: "NOTE-A" },
  });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  v.switchTo("form-b");
  await open("会议：记笔记");
  expect((screen.getByLabelText("会议笔记") as HTMLTextAreaElement).value).toBe(
    "",
  );
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  v.switchTo("form-a");
  await open("会议：记笔记");
  expect((screen.getByLabelText("会议笔记") as HTMLTextAreaElement).value).toBe(
    "NOTE-A",
  );
});
it("keeps the branch operation on the opening project", async () => {
  const v = mount();
  await open("创建分支");
  fireEvent.change(screen.getByLabelText("分支名称"), {
    target: { value: "feature-a" },
  });
  v.switchTo("form-b");
  fireEvent.click(screen.getByRole("button", { name: "创建并检出" }));
  await waitFor(() =>
    expect(api.gitCreateBranch).toHaveBeenCalledWith("/fixture/a", "feature-a"),
  );
});
it("keeps commit text and operation on the opening project", async () => {
  const v = mount();
  await open("提交或推送");
  fireEvent.click(screen.getByRole("button", { name: "提交更改" }));
  fireEvent.change(screen.getByLabelText("Git 提交说明"), {
    target: { value: "COMMIT-A" },
  });
  v.switchTo("form-b");
  fireEvent.click(screen.getByRole("button", { name: "提交更改" }));
  await waitFor(() =>
    expect(api.gitCommit).toHaveBeenCalledWith("/fixture/a", "COMMIT-A"),
  );
});
it("keeps the PR project and edited title/body when another thread becomes current", async () => {
  const v = mount();
  await open("创建 PR");
  await screen.findByLabelText("PR 标题");
  fireEvent.change(screen.getByLabelText("PR 标题"), {
    target: { value: "TITLE-A" },
  });
  fireEvent.change(screen.getByLabelText("PR 描述"), {
    target: { value: "BODY-A" },
  });
  v.switchTo("form-b");
  await act(async () => {});
  expect((screen.getByLabelText("PR 标题") as HTMLInputElement).value).toBe(
    "TITLE-A",
  );
  expect(
    screen
      .getByRole("link", { name: "在 GitHub 上创建 PR" })
      .getAttribute("href"),
  ).toContain("/repo-a/compare/branch-a?");
  expect(api.gitBranchInfo).not.toHaveBeenCalledWith("/fixture/b");
});
it.each(["归档聊天", "删除聊天"])(
  "rejects %s after the captured runtime/account scope is revoked",
  async (label) => {
    mount();
    await open(label);
    invalidateCodexOperationScope();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: label === "归档聊天" ? "确认归档" : "删除",
      }),
    );
    await act(async () => {});
    expect(api.archiveThread).not.toHaveBeenCalled();
    expect(api.deleteThread).not.toHaveBeenCalled();
  },
);
it("restores the note after the main composer owner-key unmounts and returns", async () => {
  const v = mount();
  await open("会议：记笔记");
  fireEvent.change(screen.getByLabelText("会议笔记"), {
    target: { value: "UNSAVED-A" },
  });
  v.unmount();
  mount();
  await open("会议：记笔记");
  expect((screen.getByLabelText("会议笔记") as HTMLTextAreaElement).value).toBe(
    "UNSAVED-A",
  );
});

it("keeps submitted target A and ignores its receipt after account/runtime revocation", async () => {
  let finish!: () => void;
  api.archiveThread.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const v = mount();
  await open("归档聊天");
  fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
  await waitFor(() => expect(api.archiveThread).toHaveBeenCalledWith("form-a"));
  v.switchTo("form-b");
  invalidateCodexOperationScope();
  await act(async () => finish());
  expect(useCodexStore.getState().threads.map((t) => t.id)).toEqual([
    "form-a",
    "form-b",
  ]);
  expect(useCodexStore.getState().currentThreadId).toBe("form-b");
  expect(screen.getByRole("alert").textContent).toContain("旧操作回执");
  fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
  expect(api.archiveThread).toHaveBeenCalledTimes(1);
});
it("keeps a pending branch operation locked across owner-key remount, preserving its draft", async () => {
  let finish!: () => void;
  api.gitCreateBranch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const v = mount();
  await open("创建分支");
  fireEvent.change(screen.getByLabelText("分支名称"), {
    target: { value: "PENDING-A" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建并检出" }));
  await waitFor(() => expect(api.gitCreateBranch).toHaveBeenCalledTimes(1));
  v.unmount();
  mount();
  await open("创建分支");
  expect((screen.getByLabelText("分支名称") as HTMLInputElement).value).toBe(
    "PENDING-A",
  );
  expect(
    (screen.getByRole("button", { name: "创建并检出" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () => finish());
  expect(api.gitCreateBranch).toHaveBeenCalledTimes(1);
});
it("guards project writes and PR links against a revoked scope without clearing edited fields", async () => {
  mount();
  await open("创建分支");
  fireEvent.change(screen.getByLabelText("分支名称"), {
    target: { value: "PRIVATE-A" },
  });
  invalidateCodexOperationScope();
  fireEvent.click(screen.getByRole("button", { name: "创建并检出" }));
  await act(async () => {});
  expect(api.gitCreateBranch).not.toHaveBeenCalled();
  expect((screen.getByLabelText("分支名称") as HTMLInputElement).value).toBe(
    "PRIVATE-A",
  );
});
it("preserves edited PR fields across the main composer unmount and return", async () => {
  const v = mount();
  await open("创建 PR");
  await screen.findByLabelText("PR 标题");
  fireEvent.change(screen.getByLabelText("PR 标题"), {
    target: { value: "EDITED-A" },
  });
  fireEvent.change(screen.getByLabelText("PR 描述"), {
    target: { value: "BODY-A" },
  });
  v.unmount();
  mount();
  await open("创建 PR");
  await screen.findByLabelText("PR 标题");
  expect((screen.getByLabelText("PR 标题") as HTMLInputElement).value).toBe(
    "EDITED-A",
  );
  expect((screen.getByLabelText("PR 描述") as HTMLTextAreaElement).value).toBe(
    "BODY-A",
  );
});
it("keeps a new B form and text when an already sent A commit completes", async () => {
  let finish!: () => void;
  api.gitCommit.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const v = mount();
  await open("提交或推送");
  fireEvent.click(screen.getByRole("button", { name: "提交更改" }));
  fireEvent.change(screen.getByLabelText("Git 提交说明"), {
    target: { value: "SENT-A" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交更改" }));
  await waitFor(() =>
    expect(api.gitCommit).toHaveBeenCalledWith("/fixture/a", "SENT-A"),
  );
  v.unmount();
  const next = mount();
  next.switchTo("form-b");
  await open("提交或推送");
  fireEvent.click(screen.getByRole("button", { name: "提交更改" }));
  fireEvent.change(screen.getByLabelText("Git 提交说明"), {
    target: { value: "NEW-B" },
  });
  await act(async () => finish());
  expect(
    (screen.getByLabelText("Git 提交说明") as HTMLTextAreaElement).value,
  ).toBe("NEW-B");
  expect(screen.getByRole("dialog").textContent).toContain("Form B");
  expect(api.gitCommit).toHaveBeenCalledTimes(1);
});
it("does not clear a newer revision of the original owner draft on a delayed receipt", async () => {
  const { changeConversationForm, useConversationFormDrafts } =
    await import("./conversationFormDrafts");
  let finish!: () => void;
  api.gitCreateBranch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await open("创建分支");
  fireEvent.change(screen.getByLabelText("分支名称"), {
    target: { value: "SUBMITTED" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建并检出" }));
  await waitFor(() => expect(api.gitCreateBranch).toHaveBeenCalledTimes(1));
  const key = Object.keys(useConversationFormDrafts.getState().drafts)[0];
  act(() => changeConversationForm(key, "branch", "NEWER-FORM-REVISION"));
  await act(async () => finish());
  await open("创建分支");
  expect((screen.getByLabelText("分支名称") as HTMLInputElement).value).toBe(
    "NEWER-FORM-REVISION",
  );
});
it("prevents a revoked PR link and preserves its text", async () => {
  mount();
  await open("创建 PR");
  await screen.findByLabelText("PR 标题");
  fireEvent.change(screen.getByLabelText("PR 描述"), {
    target: { value: "BODY-A" },
  });
  invalidateCodexOperationScope();
  expect(
    fireEvent.click(screen.getByRole("link", { name: "在 GitHub 上创建 PR" })),
  ).toBe(false);
  expect((screen.getByLabelText("PR 描述") as HTMLTextAreaElement).value).toBe(
    "BODY-A",
  );
});
it("prevents a revoked note from being appended and keeps the editable buffer", async () => {
  mount();
  await open("会议：记笔记");
  fireEvent.change(screen.getByLabelText("会议笔记"), {
    target: { value: "KEEP-A" },
  });
  invalidateCodexOperationScope();
  fireEvent.click(screen.getByRole("button", { name: "记入当前输入" }));
  await act(async () => {});
  expect(
    useSessionDraftStore.getState().drafts[sessionDraftKey("codex", "form-a")]
      .text,
  ).toBe("DRAFT-A");
  expect((screen.getByLabelText("会议笔记") as HTMLTextAreaElement).value).toBe(
    "KEEP-A",
  );
});
it("retains a clean confirmation through StrictMode effect replay", async () => {
  const { StrictMode } = await import("react");
  render(
    <StrictMode>
      <div className="session-mode">
        <ConversationMenu threadId="form-a" title="Form A" />
      </div>
    </StrictMode>,
  );
  await open("归档聊天");
  fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
  await waitFor(() => expect(api.archiveThread).toHaveBeenCalledWith("form-a"));
});

it("enables the normal rename action without an optional host callback, retaining its opening owner", async () => {
  const view = mount();
  await open("重命名聊天");
  fireEvent.change(screen.getByRole("textbox", { name: "会话名称" }), {
    target: { value: "Renamed A" },
  });
  view.switchTo("form-b");
  fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
  await waitFor(() =>
    expect(api.renameSession).toHaveBeenCalledExactlyOnceWith(
      "codex",
      "form-a",
      "Renamed A",
    ),
  );
});
it("preserves a cancelled rename and rejects a revoked account before writing", async () => {
  mount();
  await open("重命名聊天");
  fireEvent.change(screen.getByRole("textbox", { name: "会话名称" }), {
    target: { value: "Saved local rename" },
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
  await open("重命名聊天");
  expect(
    (screen.getByRole("textbox", { name: "会话名称" }) as HTMLInputElement)
      .value,
  ).toBe("Saved local rename");
  act(() => invalidateCodexOperationScope());
  fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("账号已变化"),
  );
  expect(api.renameSession).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("textbox", { name: "会话名称" }) as HTMLInputElement)
      .value,
  ).toBe("Saved local rename");
});
