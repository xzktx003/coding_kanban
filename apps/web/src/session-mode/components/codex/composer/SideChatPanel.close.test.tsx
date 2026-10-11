import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import { SideChatPanel } from "./SideChatPanel";

const deleteThread = vi.hoisted(() => vi.fn());
vi.mock("@session/services/apiAdapt/codex", () => ({ deleteThread }));
vi.mock("../thread/CodexThread", () => ({ CodexThread: () => null }));
vi.mock("./FollowupQueue", () => ({ FollowupQueueContent: () => null }));
vi.mock("./ModelChangeNotice", () => ({ ModelChangeNotice: () => null }));
vi.mock("./ModelReasonSelector", () => ({ ModelReasonSelector: () => null }));
vi.mock("./AccessModePopover", () => ({ AccessModePopover: () => null }));
vi.mock("@session/features/thread-workflows/PlanSidePanel", () => ({
  PlanSidePanel: () => null,
}));
vi.mock("@session/hooks/useFollowups", () => ({
  useFollowups: () => ({ state: { items: [] } }),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({ model: null }),
}));
vi.mock("../../common/useImageAttachments", () => ({
  useImageAttachments: () => ({
    paths: [],
    attachments: [],
    blocked: false,
    storageError: null,
    onPaste: () => {},
    clear: () => {},
  }),
}));
vi.mock("../../common/useStopAction", () => ({ useStopAction: () => vi.fn() }));
vi.mock("../hooks/useTurnControl", () => ({
  useTurnControl: () => ({ running: false, turnId: null }),
}));
vi.mock("@session/services/followupService", () => ({
  followupService: { submit: vi.fn() },
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: vi.fn(), loadThreadHistory: vi.fn() },
}));

it("deletes the side chat after the plugin close confirmation", () => {
  localStorage.removeItem("kanban.session.side-chat-close-skip");
  deleteThread.mockResolvedValue(undefined);
  useCodexStore.setState({
    threads: [
      { id: "parent", name: "主会话" },
      { id: "side-1", name: "侧边" },
    ],
    events: { "side-1": [] },
  } as never);
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "parent" },
      { kind: "codex", id: "side-1" },
    ],
  } as never);
  useSideChatStore.setState({
    chat: { id: "side-1", parentId: "parent", title: "侧边聊天", images: [] },
  });
  render(<SideChatPanel />);
  fireEvent.click(screen.getByRole("button", { name: "返回主会话" }));
  expect(deleteThread).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭侧边聊天" }));
  expect(useSideChatStore.getState().chat).toBeNull();
  expect(useCodexStore.getState().threads.map((thread) => thread.id)).toEqual([
    "parent",
  ]);
  expect(
    useAgentCenterStore.getState().cards.map((card) => card.id),
  ).toEqual(["parent"]);
  expect(deleteThread).toHaveBeenCalledWith("side-1");
});

it("moves focus to the side chat input when requested", async () => {
  useSideChatStore.setState({
    chat: { id: "side-1", parentId: "parent", title: "侧边聊天", images: [] },
    focusTrigger: 0,
  });
  render(<SideChatPanel />);
  const input = screen.getByRole("textbox", { name: "侧边聊天输入" });
  input.blur();
  expect(document.activeElement).not.toBe(input);
  act(() => {
    useSideChatStore.getState().requestFocus();
  });
  await waitFor(() => expect(document.activeElement).toBe(input));
});
