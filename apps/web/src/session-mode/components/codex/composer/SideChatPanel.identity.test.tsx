import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "../stores/useCodexStore";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import {
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import {
  confirmSubagentMetadata,
  useSubagentStore,
} from "@session/features/subagents/store";
const submit = vi.hoisted(() => vi.fn());
vi.mock("@session/services/apiAdapt/codex", () => ({ deleteThread: vi.fn() }));
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
vi.mock("../../common/useStopAction", () => ({ useStopAction: () => ({}) }));
vi.mock("../hooks/useTurnControl", () => ({
  useTurnControl: () => ({ running: false, turnId: null }),
}));
vi.mock("@session/services/followupService", () => ({
  followupService: { submit },
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { loadThreadHistory: vi.fn() },
}));
import { SideChatPanel } from "./SideChatPanel";
import { useComposerDraftStore } from "./v2/drafts";

const restoredContexts = () =>
  waitFor(() =>
    expect(
      useComposerDraftStore.getState().status[sessionDraftKey("codex", "side")]
        ?.phase,
    ).toBe("ready"),
  );
beforeEach(() => {
  submit.mockReset().mockResolvedValue({ items: [] });
  useSubagentStore.setState({
    nodes: {},
    identities: {},
    identityChecks: {},
    runtimeEpoch: 0,
    revision: 0,
  });
  useSessionDraftStore.setState({ drafts: {} });
  useCodexStore.setState({ threads: [], events: { side: [] } });
  useSideChatStore.setState({
    chat: { id: "side", parentId: "root", title: "侧边聊天", images: [] },
  });
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "side"), "keep side draft");
});
it.each([false, true])(
  "side input shares the native child capability gate (%s)",
  async (canAcceptDirectInput) => {
    confirmSubagentMetadata([
      { id: "side", parentThreadId: "root", canAcceptDirectInput },
    ]);
    render(<SideChatPanel />);
    await restoredContexts();
    const button = screen.getByRole("button", { name: "发送侧边消息" });
    expect(button.hasAttribute("disabled")).toBe(!canAcceptDirectInput);
    fireEvent.click(button);
    if (canAcceptDirectInput)
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    else {
      expect(submit).not.toHaveBeenCalled();
      expect(
        screen.getByRole("textbox", { name: "侧边聊天输入" }),
      ).toHaveProperty("value", "keep side draft");
      expect(screen.getByText(/由主 Agent 调度/)).toBeTruthy();
    }
  },
);
it("a main source permits a side input even when a legacy observation mentions that ID as a child", async () => {
  useSubagentStore.setState({
    nodes: {
      side: {
        thread: { id: "side" },
        parentId: "other",
        verified: false,
        revision: 0,
      },
    },
  });
  useCodexStore.setState({
    threads: [{ id: "side", source: "vscode", parentThreadId: null }] as any,
  });
  render(<SideChatPanel />);
  await restoredContexts();
  fireEvent.click(screen.getByRole("button", { name: "发送侧边消息" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(useSubagentStore.getState().nodes.side).toBeUndefined();
});
