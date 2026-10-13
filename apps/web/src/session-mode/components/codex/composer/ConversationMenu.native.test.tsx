import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { useCodexStore } from "../stores/useCodexStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { usePinStore } from "@session/stores/usePinStore";
import { useLayoutStore } from "@session/stores";
import { useThreadModelStore } from "@session/stores/useThreadModelStore";
import { useModelCacheStore } from "../hooks/useModels";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";
import {
  latestUnread,
  useSessionAttentionStore,
} from "@session/stores/useSessionAttentionStore";
import {
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import { resetAppActionHistory } from "./appActionHistory";
import { rememberClosedTab, resetClosedTabs } from "@session/stores/closedSessionTabs";
import { ConversationMenu } from "./ConversationMenu";
import * as sessionTabs from "@session/stores/sessionTabSelect";
import { resetViewedChats } from "./recentView";
import { toast } from "sonner";
const request = vi.hoisted(() => vi.fn());
const collaboration = vi.hoisted(() => ({ mode: "default" as "default" | "plan" }));
const searchFiles = vi.hoisted(() => vi.fn());
const gitCommit = vi.hoisted(() => vi.fn());
const gitPush = vi.hoisted(() => vi.fn());
const gitBranchInfo = vi.hoisted(() => vi.fn());
const gitCreateBranch = vi.hoisted(() => vi.fn());
const archiveThread = vi.hoisted(() => vi.fn());
const deleteThread = vi.hoisted(() => vi.fn());
const threadFork = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@session/features/thread-workflows/actions", () => ({
  threadWorkflowActions: { request },
}));
vi.mock("@session/services/apiAdapt/filesystem", () => ({ searchFiles }));
vi.mock("@session/services/apiAdapt/git", () => ({
  gitCommit,
  gitPush,
  gitBranchInfo,
  gitCreateBranch,
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "original-model",
    reasoningEffort:
      useThreadModelStore.getState().threads["original-owner"]?.reasoningEffort ??
      "medium",
    setReasoningEffort: (effort: string) => {
      const current = useThreadModelStore.getState().threads["original-owner"];
      useThreadModelStore.setState({
        threads: {
          "original-owner": { ...current, reasoningEffort: effort } as never,
        },
      });
    },
    serviceTier:
      useThreadModelStore.getState().threads["original-owner"]?.serviceTier ?? null,
    setServiceTier: (tier: string | null) => {
      useThreadModelStore.setState({
        threads: {
          "original-owner": { serviceTier: tier } as never,
        },
      });
    },
    get collaborationMode() {
      return collaboration.mode;
    },
    setCollaborationMode: (mode: "default" | "plan") => {
      collaboration.mode = mode;
    },
  }),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  archiveThread,
  deleteThread,
  threadAccess: vi.fn(),
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { threadFork },
}));
it("opens each workflow for the conversation that owns the menu", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  for (const [label, action] of [
    ["查找聊天", "search"],
    ["用户消息导航", "users"],
    ["导出 Markdown", "export"],
    ["复制为 Markdown", "copyMarkdown"],
    ["复制深层链接", "copyDeeplink"],
    ["复制会话链接", "copyLink"],
  ]) {
    fireEvent.keyDown(
      screen.getByRole("button", { name: "当前会话的更多操作" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    expect(request).toHaveBeenLastCalledWith("original-owner", action);
  }
});

it("copies the last assistant code block from the open thread", async () => {
  useCodexStore.setState({
    events: {
      "original-owner": [
        {
          params: {
            item: { type: "agentMessage", text: "```ts\nconst answer = 1;\n```" },
          },
        },
      ],
    },
  } as never);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制最后一个代码块" }));
  expect(writeText).toHaveBeenCalledWith("const answer = 1;");
});

it("copies the open thread working directory", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制工作目录" }));
  expect(writeText).toHaveBeenCalledWith("/fixture/project");
});

it("marks the open thread unread from its latest read reply", async () => {
  const attention = useSessionAttentionStore.getState();
  attention.complete("codex", "original-owner", "reply-1");
  attention.read("codex", "original-owner", "reply-1");
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "标记为未读" }));
  expect(
    latestUnread(useSessionAttentionStore.getState().receipts["codex:original-owner"]),
  ).toBe("reply-1");
});

it("clears only the open composer draft", async () => {
  const owner = sessionDraftKey("codex", "original-owner");
  useSessionDraftStore.getState().setText(owner, "保留到点击清除");
  useSessionDraftStore.getState().setText(sessionDraftKey("codex", "other"), "别动");
  const composer = document.createElement("div");
  composer.className = "session-codex-composer";
  composer.setAttribute("data-draft-owner", owner);
  document.body.append(composer);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "清除提示" }));
  expect(useSessionDraftStore.getState().drafts[owner].text).toBe("");
  expect(useSessionDraftStore.getState().drafts[sessionDraftKey("codex", "other")].text).toBe(
    "别动",
  );
  composer.remove();
});

it("copies the open thread disk path", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", path: "/fixture/sessions/owner.jsonl" }],
  } as never);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制对话路径" }));
  expect(writeText).toHaveBeenCalledWith("/fixture/sessions/owner.jsonl");
});

it("searches the open thread directory and opens the chosen file", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  searchFiles.mockResolvedValue([
    { name: "note.ts", path: "/fixture/project/note.ts", is_dir: false },
  ]);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "搜索文件" }));
  const field = await screen.findByRole("textbox", { name: "搜索文件" });
  expect(field.getAttribute("placeholder")).toBe("搜索文件…");
  fireEvent.change(field, { target: { value: "note" } });
  await waitFor(() =>
    expect(searchFiles).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/fixture/project", query: "note" }),
    ),
  );
  fireEvent.click(await screen.findByRole("option", { name: "note.ts" }));
  expect(useEditorStore.getState().activeFile).toBe("/fixture/project/note.ts");
});

it("opens the shipped commit dialog for the thread directory", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  gitCommit.mockResolvedValue("ok");
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "提交或推送" }));
  const options = await screen.findByRole("dialog", { name: "提交或推送" });
  expect(options.textContent).toContain("打开提交或推送选项");
  fireEvent.click(screen.getByRole("button", { name: "提交更改" }));
  const dialog = await screen.findByRole("dialog", { name: "提交 Git 更改" });
  expect(dialog.textContent).toContain("填写提交说明，将当前已暂存的更改提交到本地仓库。");
  fireEvent.change(screen.getByRole("textbox", { name: "Git 提交说明" }), {
    target: { value: "记录菜单提交" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交更改" }));
  await waitFor(() =>
    expect(gitCommit).toHaveBeenCalledWith("/fixture/project", "记录菜单提交"),
  );
});

it("pushes the thread directory from the commit or push options", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  gitPush.mockResolvedValue("ok");
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "提交或推送" }));
  fireEvent.click(await screen.findByRole("button", { name: "推送到远程仓库" }));
  await waitFor(() => expect(gitPush).toHaveBeenCalledWith("/fixture/project"));
});

it("keeps commit or push closed when the thread has no directory", async () => {
  useCodexStore.setState({ threads: [{ id: "original-owner" }] } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "提交或推送" }));
  expect(toast.message).toHaveBeenCalledWith("当前聊天没有工作目录");
  expect(screen.queryByRole("dialog", { name: "提交或推送" })).toBeNull();
});

it("opens a GitHub compare page for the thread branch", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  gitBranchInfo.mockResolvedValue({
    owner: "fixture",
    repo: "fixture",
    branch: "feature/ui",
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "创建 PR" }));
  const dialog = await screen.findByRole("dialog", { name: "创建 PR" });
  expect(dialog.textContent).toContain("打开 Pull Request 创建选项");
  expect(dialog.textContent).toContain("fixture/fixture");
  const link = await screen.findByRole("link", { name: "在 GitHub 上创建 PR" });
  expect(link.getAttribute("href")).toContain(
    "https://github.com/fixture/fixture/compare/feature/ui",
  );
});

it("opens GitHub merge options for the thread branch", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  gitBranchInfo.mockResolvedValue({
    owner: "fixture",
    repo: "fixture",
    branch: "feature/ui",
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "合并 PR" }));
  const dialog = await screen.findByRole("dialog", { name: "合并 PR" });
  expect(dialog.textContent).toContain("打开 Pull Request 合并选项");
  expect(dialog.textContent).toContain("本机没有 GitHub CLI");
  const link = await screen.findByRole("link", { name: "在 GitHub 上打开合并选项" });
  expect(link.getAttribute("href")).toContain(
    "https://github.com/fixture/fixture/pulls?q=is%3Aopen+head%3Afeature%2Fui",
  );
});

it("forks the open thread into a new followed chat", async () => {
  threadFork.mockResolvedValue({
    id: "forked-chat",
    name: "侧边聊天",
    preview: "侧边聊天",
    cwd: "/fixture/project",
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "分叉聊天" }));
  await waitFor(() => expect(threadFork).toHaveBeenCalledWith("original-owner"));
  expect(useCodexStore.getState().currentThreadId).toBe("forked-chat");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("forked-chat");
  expect(
    useCodexStore.getState().threads.find((thread) => thread.id === "forked-chat")?.name,
  ).toBe("分叉聊天");
  expect(useSessionNameStore.getState().names["codex:forked-chat"]).toBe("分叉聊天");
  expect(
    useAgentCenterStore.getState().cards.some((card) => card.id === "forked-chat"),
  ).toBe(true);
});

it("opens the search and switch sheet", async () => {
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "original-owner", preview: "当前会话" }],
  } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "切换聊天…" }));
  const dialog = await screen.findByRole("dialog", { name: "切换聊天…" });
  expect(dialog.textContent).toContain("搜索并切换到聊天");
  expect(screen.getByRole("option", { name: "当前会话" })).toBeTruthy();
});

it("toggles the project sidebar as the activity view", async () => {
  useLayoutStore.setState({ isSidebarOpen: false });
  const opened = vi.fn();
  window.addEventListener("session-open-projects", opened);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "切换活动视图" }));
  };
  await open();
  expect(useLayoutStore.getState().isSidebarOpen).toBe(true);
  expect(opened).toHaveBeenCalledOnce();
  await open();
  expect(useLayoutStore.getState().isSidebarOpen).toBe(false);
  window.removeEventListener("session-open-projects", opened);
});

it("asks the main composer to take keyboard focus", async () => {
  useCodexStore.setState({ inputFocusTrigger: 3 });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "聚焦主聊天输入框" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });
  expect(useCodexStore.getState().inputFocusTrigger).toBe(4);
  expect(toast.message).toHaveBeenCalledWith("已聚焦主聊天输入框");
});

it("opens a side chat from the current conversation", async () => {
  useSideChatStore.setState({ chat: null, focusTrigger: 2 });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "打开侧边聊天" }));
  };
  await open();
  expect(toast.message).not.toHaveBeenCalledWith("当前没有打开的侧边聊天");
  useSideChatStore.setState({
    chat: { id: "side-1", parentId: "original-owner", title: "侧边聊天", images: [] },
  });
  await open();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });
  expect(useSideChatStore.getState().focusTrigger).toBe(3);
  expect(toast.message).toHaveBeenCalledWith("已打开侧边聊天");
});

it("selects or pans the open artifact canvas", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async (name: string) => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name }));
  };
  await open("工件：选择");
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open("工件：平移");
  expect(toast.message).toHaveBeenCalledWith("已切换为平移工件");
  canvas.remove();
});

it("opens a canvas prompt only while a drawing canvas is open", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "画布：询问 ChatGPT" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open();
  expect(toast.message).toHaveBeenCalledWith("已打开画布提示");
  canvas.remove();
});

it("switches the open canvas to the rectangle tool", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "工件：矩形" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open();
  expect(toast.message).toHaveBeenCalledWith("已切换为矩形");
  canvas.remove();
});

it("switches the open canvas to the circle tool", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "工件：圆形" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open();
  expect(toast.message).toHaveBeenCalledWith("已切换为圆形");
  canvas.remove();
});

it("switches the open canvas to the arrow tool", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "工件：箭头" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open();
  expect(toast.message).toHaveBeenCalledWith("已切换为箭头");
  canvas.remove();
});

it("switches the open canvas to the line tool", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "工件：直线" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open();
  expect(toast.message).toHaveBeenCalledWith("已切换为直线");
  canvas.remove();
});

it("switches the open canvas to the text tool", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "工件：文本" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open();
  expect(toast.message).toHaveBeenCalledWith("已切换为文本");
  canvas.remove();
});

it("switches the open canvas to the note tool", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "工件：便签" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的工件画布");
  const canvas = document.createElement("div");
  canvas.className = "session-drawing-canvas";
  document.body.appendChild(canvas);
  await open();
  expect(toast.message).toHaveBeenCalledWith("已切换为便签");
  canvas.remove();
});

it("copies the current page address as the page link", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "复制页面链接" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
  expect(toast.success).toHaveBeenCalledWith("已复制页面链接");
});

it("focuses expanded editor controls only while the page editor is open", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "将焦点移至内容控件" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的页面编辑器");
  const sheet = document.createElement("div");
  sheet.className = "session-composer-sheet is-full";
  const editor = document.createElement("textarea");
  const tools = document.createElement("div");
  tools.className = "session-rich-tools";
  const control = document.createElement("button");
  control.textContent = "纯文本模式";
  tools.append(control);
  sheet.append(editor, tools);
  document.body.append(sheet);
  await open();
  expect(document.activeElement).toBe(control);
  expect(toast.message).toHaveBeenCalledWith("已聚焦内容控件");
  sheet.remove();
});

it("numbers the expanded draft and reports when no editor is open", async () => {
  useSessionDraftStore.setState({
    drafts: { "codex-owner": { text: "alpha\nbeta", revision: 1 } },
  } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "编号列表" }));
  };
  await open();
  expect(toast.message).toHaveBeenCalledWith("当前没有打开的页面编辑器");
  const composer = document.createElement("div");
  composer.className = "session-codex-composer";
  composer.setAttribute("data-draft-owner", "codex-owner");
  const sheet = document.createElement("div");
  sheet.className = "session-composer-sheet is-full";
  const draft = document.createElement("div");
  draft.className = "session-rich-draft";
  const field = document.createElement("textarea");
  field.value = "alpha\nbeta";
  field.dataset.draftSelection = "0:10";
  draft.append(field);
  sheet.append(draft);
  composer.append(sheet);
  document.body.append(composer);
  await open();
  expect(useSessionDraftStore.getState().drafts["codex-owner"].text).toBe(
    "1. alpha\n2. beta",
  );
  expect(toast.message).toHaveBeenCalledWith("已设置为编号列表");
  composer.remove();
});

it("turns the expanded draft into a bulleted list", async () => {
  useSessionDraftStore.setState({
    drafts: { "codex-owner": { text: "alpha\nbeta", revision: 1 } },
  } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const composer = document.createElement("div");
  composer.className = "session-codex-composer";
  composer.setAttribute("data-draft-owner", "codex-owner");
  const sheet = document.createElement("div");
  sheet.className = "session-composer-sheet is-full";
  const draft = document.createElement("div");
  draft.className = "session-rich-draft";
  const field = document.createElement("textarea");
  field.value = "alpha\nbeta";
  field.dataset.draftSelection = "0:10";
  draft.append(field);
  sheet.append(draft);
  composer.append(sheet);
  document.body.append(composer);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "项目符号列表" }));
  expect(useSessionDraftStore.getState().drafts["codex-owner"].text).toBe(
    "- alpha\n- beta",
  );
  expect(toast.message).toHaveBeenCalledWith("已设置为项目符号列表");
  composer.remove();
});

it("toggles an expanded draft checklist", async () => {
  useSessionDraftStore.setState({
    drafts: { "codex-owner": { text: "alpha", revision: 1 } },
  } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const composer = document.createElement("div");
  composer.className = "session-codex-composer";
  composer.setAttribute("data-draft-owner", "codex-owner");
  const sheet = document.createElement("div");
  sheet.className = "session-composer-sheet is-full";
  const draft = document.createElement("div");
  draft.className = "session-rich-draft";
  const field = document.createElement("textarea");
  field.value = "alpha";
  field.dataset.draftSelection = "0:5";
  draft.append(field);
  sheet.append(draft);
  composer.append(sheet);
  document.body.append(composer);
  const choose = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "核对清单" }));
  };
  await choose();
  expect(useSessionDraftStore.getState().drafts["codex-owner"].text).toBe("- [ ] alpha");
  field.value = "- [ ] alpha";
  field.dataset.draftSelection = "0:10";
  await choose();
  expect(useSessionDraftStore.getState().drafts["codex-owner"].text).toBe("alpha");
  expect(toast.message).toHaveBeenCalledWith("已切换核对清单");
  composer.remove();
});

it("opens the remaining plugin command-menu surfaces", async () => {
  useLayoutStore.setState({
    view: "agent",
    isSidebarOpen: true,
    isRightPanelOpen: false,
    isRightPanelFocused: false,
    activeRightPanelTab: "diff",
  });
  const opened = vi.fn();
  const feedback = vi.fn();
  window.addEventListener("session-open-projects", opened);
  window.addEventListener("codex-open-feedback", feedback);
  const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
  const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const choose = async (name: string) => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name }));
  };
  await choose("强制重新加载技能");
  expect(toast.message).toHaveBeenCalledWith("无法刷新技能和应用");
  await choose("打开文件夹…");
  expect(opened).toHaveBeenCalled();
  await choose("显示/隐藏侧边栏");
  expect(useLayoutStore.getState().isSidebarOpen).toBe(false);
  await choose("显示/隐藏导航面板");
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("files");
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
  await choose("显示/隐藏底部面板");
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("terminal");
  await choose("显示/隐藏固定摘要");
  expect(toast.message).toHaveBeenCalledWith("当前没有可切换的置顶摘要");
  await choose("打开终端");
  expect(toast.message).toHaveBeenCalledWith("已打开终端面板");
  await choose("打开“变更”选项卡");
  expect(toast.message).toHaveBeenCalledWith("已打开“变更”选项卡");
  await choose("查找");
  expect(request).toHaveBeenCalledWith("original-owner", "search");
  await choose("完整视图");
  expect(toast.message).toHaveBeenCalledWith("本机没有独立完整视图");
  await choose("循环切换工作空间布局");
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(false);
  await choose("打开浏览器标签页");
  expect(toast.message).toHaveBeenCalledWith("本机没有应用内浏览器标签页");
  await choose("转到行");
  expect(toast.message).toHaveBeenCalledWith("当前文件没有转到行");
  await choose("返回");
  expect(back).toHaveBeenCalled();
  await choose("前进");
  expect(forward).toHaveBeenCalled();
  await choose("聚焦浏览器地址栏");
  expect(toast.message).toHaveBeenCalledWith("本机没有应用内浏览器地址栏");
  await choose("退出登录");
  expect(useLayoutStore.getState().view).toBe("settings");
  await choose("反馈");
  expect(feedback).toHaveBeenCalled();
  window.removeEventListener("session-open-projects", opened);
  window.removeEventListener("codex-open-feedback", feedback);
  back.mockRestore();
  forward.mockRestore();
});

it("opens scheduled tasks and installed skills from the menu", async () => {
  useLayoutStore.setState({ view: "agent" });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "管理已安排任务" }));
  expect(useLayoutStore.getState().view).toBe("automations");
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "前往技能" }));
  expect(useLayoutStore.getState().view).toBe("plugins");
});

it("marks every followed Codex chat read", async () => {
  useSessionAttentionStore.setState({ receipts: {} });
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "original-owner" },
      { kind: "cc", id: "original-owner" },
    ],
  } as never);
  useSessionAttentionStore.getState().complete("codex", "original-owner", "reply");
  useSessionAttentionStore.getState().complete("cc", "original-owner", "other");
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "全部标为已读" }));
  expect(toast.message).toHaveBeenCalledWith("已全部标为已读");
  expect(
    useSessionAttentionStore.getState().receipts["codex:original-owner"].read,
  ).toContain("reply");
  expect(
    useSessionAttentionStore.getState().receipts["cc:original-owner"].read,
  ).toEqual([]);
});

it("shows the active shortcut list from the menu", async () => {
  const opened = vi.fn();
  window.addEventListener("codex-open-keyboard-shortcuts", opened);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "显示键盘快捷键" }));
  expect(opened).toHaveBeenCalled();
  window.removeEventListener("codex-open-keyboard-shortcuts", opened);
});

it("asks the menu to open keyboard shortcuts", async () => {
  const opened = vi.fn();
  window.addEventListener("codex-open-keyboard-shortcuts", opened);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "键盘快捷方式" }));
  expect(opened).toHaveBeenCalled();
  window.removeEventListener("codex-open-keyboard-shortcuts", opened);
});

it("reports that no compatible external agent data can be imported", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "从其他 AI 应用导入" }));
  expect(toast.message).toHaveBeenCalledWith("未找到兼容的导入项", {
    description: "后摩智能找不到来自其他编程智能体的兼容数据",
  });
});

it("asks the composer to open the personality sheet", async () => {
  const opened = vi.fn();
  window.addEventListener("codex-open-personality", opened);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "个性" }));
  expect(opened).toHaveBeenCalled();
  window.removeEventListener("codex-open-personality", opened);
});

it("asks the composer to open MCP server status", async () => {
  const opened = vi.fn();
  window.addEventListener("codex-open-mcp", opened);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "MCP" }));
  expect(opened).toHaveBeenCalled();
  window.removeEventListener("codex-open-mcp", opened);
});

it("opens the session settings page", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", {
    ...window.location,
    href: "http://127.0.0.1:8485/?mode=session&view=agent",
    assign,
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "设置" }));
  expect(assign).toHaveBeenCalledWith(expect.stringContaining("view=settings"));
  expect(assign).toHaveBeenCalledWith(expect.stringContaining("mode=session"));
  vi.unstubAllGlobals();
});

it("stays on the Codex session when that mode is already open", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", {
    ...window.location,
    href: "http://127.0.0.1:8485/?mode=session&view=agent",
    assign,
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "切换到 Codex" }));
  expect(toast.message).toHaveBeenCalledWith("当前已是 Codex 会话");
  expect(assign).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("reports that this machine has no ChatGPT work mode", async () => {
  useLayoutStore.setState({ view: "agent" } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "切换到工作" }));
  expect(toast.message).toHaveBeenCalledWith("本机没有 ChatGPT 工作模式");
  expect(useLayoutStore.getState().view).toBe("agent");
});

it("returns the session view to the chat page", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, href: "http://127.0.0.1:8485/?mode=session&view=settings", assign });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "切换到聊天" }));
  expect(assign).toHaveBeenCalledWith(expect.stringContaining("view=agent"));
  expect(assign).toHaveBeenCalledWith(expect.stringContaining("mode=session"));
  vi.unstubAllGlobals();
});

it("switches to the next recently viewed followed chat", async () => {
  resetViewedChats();
  const select = vi.spyOn(sessionTabs, "sessionTabSelect").mockResolvedValue(undefined);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "older-chat" },
      { kind: "codex", id: "recent-chat", preview: "刚才" },
      { kind: "codex", id: "original-owner" },
    ],
    currentAgentCardId: "recent-chat",
  } as never);
  useAgentCenterStore.setState({ currentAgentCardId: "original-owner" } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "下一个最近查看的聊天" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "recent-chat" }));
  expect(toast.message).toHaveBeenCalledWith("已切换到下一个最近查看的聊天");
  select.mockRestore();
});

it("opens the first recently viewed chat slot", async () => {
  resetViewedChats();
  const select = vi.spyOn(sessionTabs, "sessionTabSelect").mockResolvedValue(undefined);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "older-chat" },
      { kind: "codex", id: "slot-chat", preview: "槽位" },
    ],
    currentAgentCardId: "older-chat",
  } as never);
  useAgentCenterStore.setState({ currentAgentCardId: "slot-chat" } as never);
  render(<ConversationMenu threadId="slot-chat" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "转到最近聊天 1" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "slot-chat" }));
  expect(toast.message).toHaveBeenCalledWith("已打开最近聊天 1");
  select.mockRestore();
});

it("opens later recent slots and focuses a tab by position", async () => {
  resetViewedChats();
  const select = vi.spyOn(sessionTabs, "sessionTabSelect").mockResolvedValue(undefined);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "tab-one" },
      { kind: "codex", id: "tab-two", preview: "第二" },
    ],
    currentAgentCardId: "tab-one",
  } as never);
  useAgentCenterStore.setState({ currentAgentCardId: "tab-two" } as never);
  render(<ConversationMenu threadId="tab-two" title="当前会话" />);
  const open = () =>
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
  open();
  fireEvent.click(await screen.findByRole("menuitem", { name: "转到最近聊天 2" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "tab-one" }));
  expect(toast.message).toHaveBeenCalledWith("已打开最近聊天 2");
  open();
  fireEvent.click(await screen.findByRole("menuitem", { name: "聚焦第 2 个标签页" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "tab-two" }));
  expect(toast.message).toHaveBeenCalledWith("已聚焦第 2 个标签页");
  select.mockRestore();
});

it("switches to the next followed chat", async () => {
  const select = vi.spyOn(sessionTabs, "sessionTabSelect").mockResolvedValue(undefined);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "original-owner" },
      { kind: "codex", id: "later-chat", preview: "更后" },
    ],
    currentAgentCardId: "original-owner",
  } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "下一个聊天" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "later-chat" }));
  expect(toast.message).toHaveBeenCalledWith("已切换到下一个聊天");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("later-chat");
  select.mockRestore();
});

it("switches to the previous followed chat", async () => {
  const select = vi.spyOn(sessionTabs, "sessionTabSelect").mockResolvedValue(undefined);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "earlier-chat", preview: "更早" },
      { kind: "codex", id: "original-owner" },
    ],
    currentAgentCardId: "original-owner",
  } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "上一个聊天" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "earlier-chat" }));
  expect(toast.message).toHaveBeenCalledWith("已切换到上一个聊天");
  select.mockRestore();
});

it("switches to the next followed chat that needs attention", async () => {
  const select = vi.spyOn(sessionTabs, "sessionTabSelect").mockResolvedValue(undefined);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "original-owner" },
      { kind: "codex", id: "quiet-chat", preview: "安静" },
      { kind: "codex", id: "attention-chat", preview: "待看" },
    ],
    currentAgentCardId: "original-owner",
  } as never);
  useSessionAttentionStore.setState({ receipts: {} });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = () =>
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
  open();
  fireEvent.click(await screen.findByRole("menuitem", { name: "下一个需关注的聊天" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(toast.message).toHaveBeenCalledWith("没有需关注的聊天");
  expect(select).not.toHaveBeenCalled();
  useSessionAttentionStore.getState().complete("codex", "attention-chat", "reply-next");
  open();
  fireEvent.click(await screen.findByRole("menuitem", { name: "下一个需关注的聊天" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ id: "attention-chat" }),
  );
  expect(toast.message).toHaveBeenCalledWith("已切换到下一个需关注的聊天");
  select.mockRestore();
});

it("reports that this machine has no Dot conversation", async () => {
  useAgentCenterStore.setState({ cards: [] } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "打开您的 Dot" }));
  expect(toast.message).toHaveBeenCalledWith("本机没有与 Dot 的对话");
  expect(useAgentCenterStore.getState().cards).toEqual([]);
});

it("shows git blame for the open file", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  useEditorStore.setState({ gitBlame: false });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "切换 Git 追溯信息" }));
  expect(useEditorStore.getState().gitBlame).toBe(true);
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("files");
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
});

it("opens GitHub pull requests for the thread branch", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  gitBranchInfo.mockResolvedValue({
    owner: "fixture",
    repo: "fixture",
    branch: "feature/ui",
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "在 GitHub 上打开 PR" }));
  const dialog = await screen.findByRole("dialog", { name: "在 GitHub 上打开 PR" });
  expect(dialog.textContent).toContain("打开与当前聊天关联的 Pull Request");
  expect(dialog.textContent).toContain("当前聊天没有绑定的 Pull Request 编号");
  const link = await screen.findByRole("link", { name: "在 GitHub 上打开 PR" });
  expect(link.getAttribute("href")).toBe(
    "https://github.com/fixture/fixture/pulls?q=head%3Afeature%2Fui",
  );
});

it("creates and checks out a branch in the thread directory", async () => {
  useCodexStore.setState({
    threads: [{ id: "original-owner", cwd: "/fixture/project" }],
  } as never);
  gitCreateBranch.mockResolvedValue(undefined);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "创建分支" }));
  const dialog = await screen.findByRole("dialog", { name: "创建分支" });
  expect(dialog.textContent).toContain("打开分支创建选项");
  fireEvent.change(screen.getByRole("textbox", { name: "分支名称" }), {
    target: { value: "feature/from-menu" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建并检出" }));
  await waitFor(() =>
    expect(gitCreateBranch).toHaveBeenCalledWith("/fixture/project", "feature/from-menu"),
  );
});

it("opens the shipped rename dialog for the current thread", async () => {
  const onRename = vi.fn();
  render(
    <ConversationMenu
      threadId="original-owner"
      title="当前会话"
      onRename={onRename}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "重命名聊天" }));
  expect(onRename).toHaveBeenCalledOnce();
});

it("archives the open thread only after confirmation", async () => {
  useCodexStore.setState({
    threads: [
      { id: "original-owner", name: "当前" },
      { id: "other", name: "其他" },
    ],
  } as never);
  archiveThread.mockResolvedValue(undefined);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "归档聊天" }));
  const dialog = await screen.findByRole("dialog", { name: "归档聊天" });
  expect(dialog.textContent).toContain("将归档当前聊天，并从关注列表移出。Agent 不会被停止。");
  expect(archiveThread).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
  await waitFor(() => expect(archiveThread).toHaveBeenCalledWith("original-owner"));
  expect(useCodexStore.getState().threads.map((thread) => thread.id)).toEqual(["other"]);
});

it("deletes the open thread only after confirmation", async () => {
  useCodexStore.setState({
    threads: [
      { id: "original-owner", name: "当前" },
      { id: "other", name: "其他" },
    ],
    currentThreadId: null,
  } as never);
  deleteThread.mockResolvedValue(undefined);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "删除聊天" }));
  const dialog = await screen.findByRole("dialog", { name: "要删除任务？" });
  expect(dialog.textContent).toContain("这将永久删除该任务及其子智能体任务。此操作无法撤销。");
  expect(deleteThread).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => expect(deleteThread).toHaveBeenCalledWith("original-owner"));
  expect(useCodexStore.getState().threads.map((thread) => thread.id)).toEqual(["other"]);
});

it("toggles the open thread pin with the plugin label", async () => {
  usePinStore.setState({ pinned: [] });
  useCodexStore.setState({
    threads: [{ id: "original-owner", name: "当前会话", cwd: "/fixture/project" }],
  } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "置顶/取消置顶聊天" }));
  };
  await open();
  expect(usePinStore.getState().pinned).toEqual([
    {
      kind: "codex",
      id: "original-owner",
      title: "当前会话",
      cwd: "/fixture/project",
    },
  ]);
  await open();
  expect(usePinStore.getState().isPinned("original-owner")).toBe(false);
});

it("shows and hides the shipped changes panel", async () => {
  useLayoutStore.setState({ isRightPanelOpen: false, activeRightPanelTab: "files" });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "显示/隐藏“变更”面板" }));
  };
  await open();
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("diff");
  await open();
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(false);
});

it("restores the same terminal tab when redoing open terminal", async () => {
  resetAppActionHistory();
  useLayoutStore.setState({
    isRightPanelOpen: false,
    activeRightPanelTab: "files",
    terminals: [],
    activeTerminalId: null,
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
  };
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "打开终端面板" }));
  const created = useLayoutStore.getState().terminals[0];
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "撤销上一步操作" }));
  expect(useLayoutStore.getState().terminals).toEqual([]);
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "重做上一步操作" }));
  expect(useLayoutStore.getState().terminals).toEqual([created]);
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("terminal");
});

it("undoes panel actions from a closed panel without inserting a null tab", async () => {
  resetAppActionHistory();
  useLayoutStore.setState({isRightPanelOpen:false,activeRightPanelTab:null,openRightPanelTabs:[],terminals:[],activeTerminalId:null});
  render(<ConversationMenu threadId="original-owner" title="当前会话"/>);
  const open=()=>fireEvent.keyDown(screen.getByRole("button",{name:"当前会话的更多操作"}),{key:"ArrowDown"});
  for(const label of ["打开终端面板","显示/隐藏“变更”面板"]){
    open();fireEvent.click(screen.getByRole("menuitem",{name:label}));
    open();fireEvent.click(screen.getByRole("menuitem",{name:"撤销上一步操作"}));
    expect(useLayoutStore.getState().activeRightPanelTab).toBeNull();
    expect(useLayoutStore.getState().openRightPanelTabs.every(tab=>typeof tab==="string")).toBe(true);
  }
});

it("undoes and redoes the last shipped app action", async () => {
  resetAppActionHistory();
  useLayoutStore.setState({ isRightPanelOpen: false, activeRightPanelTab: "files" });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
  };
  await open();
  expect(
    screen.getByRole("menuitem", { name: "撤销上一步操作" }).getAttribute("aria-disabled"),
  ).toBe("true");
  expect(
    screen.getByRole("menuitem", { name: "重做上一步操作" }).getAttribute("aria-disabled"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("menuitem", { name: "显示/隐藏“变更”面板" }));
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("diff");
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "撤销上一步操作" }));
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(false);
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("files");
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "重做上一步操作" }));
  expect(useLayoutStore.getState().isRightPanelOpen).toBe(true);
  expect(useLayoutStore.getState().activeRightPanelTab).toBe("diff");
});

it("reopens the most recently closed session tab", async () => {
  resetClosedTabs();
  useAgentCenterStore.setState({ cards: [], currentAgentCardId: null } as never);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
  };
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "重新打开已关闭的标签页" }));
  expect(useAgentCenterStore.getState().cards).toEqual([]);
  rememberClosedTab({ kind: "codex", id: "closed-tab", cwd: "/fixture", preview: "已关闭" });
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "重新打开已关闭的标签页" }));
  expect(useAgentCenterStore.getState().cards.map((card) => card.id)).toEqual([
    "closed-tab",
  ]);
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("closed-tab");
});

it("opens the shipped project list from the conversation menu", async () => {
  const opened = vi.fn();
  window.addEventListener("session-open-projects", opened);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "打开项目选择器" }));
  expect(opened).toHaveBeenCalledOnce();
  window.removeEventListener("session-open-projects", opened);
});

it("toggles the shipped dictation button as voice chat", async () => {
  const clicked = vi.fn();
  const button = document.createElement("button");
  button.setAttribute("aria-label", "听写");
  button.addEventListener("click", clicked);
  const host = document.createElement("div");
  host.className = "session-codex-composer";
  host.append(button);
  document.body.append(host);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "切换语音聊天" }));
  expect(clicked).toHaveBeenCalledOnce();
  host.remove();
});

it("mutes and ends dictation through the voice chat commands", async () => {
  const clicked = vi.fn();
  const button = document.createElement("button");
  button.setAttribute("aria-label", "停止听写");
  button.addEventListener("click", () => {
    clicked();
    button.setAttribute("aria-label", "听写");
  });
  const host = document.createElement("div");
  host.className = "session-codex-composer";
  host.append(button);
  document.body.append(host);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
  };
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "切换语音聊天麦克风" }));
  expect(clicked).toHaveBeenCalledOnce();
  await open();
  fireEvent.click(screen.getByRole("menuitem", { name: "结束语音聊天" }));
  expect(clicked).toHaveBeenCalledOnce();
  host.remove();
});

it("appends meeting notes to the open composer draft", async () => {
  const owner = sessionDraftKey("codex", "original-owner");
  useSessionDraftStore.getState().setText(owner, "已有草稿");
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "会议：记笔记" }));
  const dialog = await screen.findByRole("dialog", { name: "会议：记笔记" });
  expect(dialog.textContent).toContain("本机没有 Codex Meetings");
  fireEvent.change(screen.getByRole("textbox", { name: "会议笔记" }), {
    target: { value: "先确认范围" },
  });
  fireEvent.click(screen.getByRole("button", { name: "记入当前输入" }));
  expect(useSessionDraftStore.getState().drafts[owner]?.text).toBe(
    "已有草稿\n先确认范围",
  );
});

it("asks the open composer to pick photos", async () => {
  const opened = vi.fn();
  window.addEventListener("session-add-photos", opened);
  const host = document.createElement("div");
  host.className = "session-codex-composer";
  document.body.append(host);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "添加照片" }));
  expect(opened).toHaveBeenCalledOnce();
  host.remove();
  window.removeEventListener("session-add-photos", opened);
});

it("clicks the shipped send button for a background message", async () => {
  const clicked = vi.fn();
  const button = document.createElement("button");
  button.setAttribute("aria-label", "发送");
  button.addEventListener("click", clicked);
  const host = document.createElement("div");
  host.className = "session-codex-composer";
  host.append(button);
  document.body.append(host);
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "在后台发送消息" }));
  expect(clicked).toHaveBeenCalledOnce();
  host.remove();
});

it("cycles the catalog speed for the open thread", async () => {
  useModelCacheStore.setState({
    openAiModels: [
      {
        id: "original-model",
        model: "original-model",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
        serviceTiers: [
          { id: "fast", name: "Fast", description: "" },
          { id: "ultra", name: "Ultra", description: "" },
        ],
      } as never,
    ],
  });
  useThreadModelStore.setState({ threads: {} });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "循环切换速度" }));
  expect(useThreadModelStore.getState().threads["original-owner"]?.serviceTier).toBe(
    "fast",
  );
});

it("toggles plan mode for the open thread", async () => {
  collaboration.mode = "default";
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "切换规划模式" }));
  expect(collaboration.mode).toBe("plan");
});

it("toggles the new-task workspace between local and worktree", async () => {
  useConfigStore.setState({ threadCwdMode: "local" });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  const open = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "切换本地/工作树" }));
  };
  await open();
  expect(useConfigStore.getState().threadCwdMode).toBe("worktree");
  await open();
  expect(useConfigStore.getState().threadCwdMode).toBe("local");
});

it("reports that host cycling stays on this machine", async () => {
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "在主机间循环切换" }));
  expect(toast.message).toHaveBeenCalledWith("没有可用的远程计算机。新任务仍使用本机");
});

it("raises the open thread reasoning effort within the catalog", async () => {
  useModelCacheStore.setState({
    openAiModels: [
      {
        id: "original-model",
        model: "original-model",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
      } as never,
    ],
  });
  useThreadModelStore.setState({
    threads: { "original-owner": { reasoningEffort: "medium" } as never },
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "提高推理强度" }));
  expect(
    useThreadModelStore.getState().threads["original-owner"]?.reasoningEffort,
  ).toBe("high");
});

it("opens the shipped terminal panel", async () => {
  useLayoutStore.setState({
    isRightPanelOpen: false,
    activeRightPanelTab: "diff",
    terminals: [],
    activeTerminalId: null,
  });
  render(<ConversationMenu threadId="original-owner" title="当前会话" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "当前会话的更多操作" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "打开终端面板" }));
  const layout = useLayoutStore.getState();
  expect(layout.isRightPanelOpen).toBe(true);
  expect(layout.activeRightPanelTab).toBe("terminal");
  expect(layout.terminals).toHaveLength(1);
});
