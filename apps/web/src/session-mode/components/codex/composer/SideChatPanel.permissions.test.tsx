import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexStore } from "../stores/useCodexStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useSideChatStore } from "@session/stores/useSideChatStore";
import {
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import {
  getThreadModelSettings,
  useThreadModelStore,
  type ThreadModelEntry,
} from "@session/stores/useThreadModelStore";
import { AccessModePopover } from "./AccessModePopover";
import { SideChatPanel } from "./SideChatPanel";

const io = vi.hoisted(() => ({
  submit: vi.fn(),
  deleteThread: vi.fn(),
  loadHistory: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (({ plan: "规划", planMode: "计划模式" }) as Record<string, string>)[
        key
      ] ?? key,
  }),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  deleteThread: io.deleteThread,
}));
vi.mock("../thread/CodexThread", () => ({ CodexThread: () => null }));
vi.mock("./FollowupQueue", () => ({ FollowupQueueContent: () => null }));
vi.mock("./ModelChangeNotice", () => ({ ModelChangeNotice: () => null }));
vi.mock("./ModelReasonSelector", () => ({ ModelReasonSelector: () => null }));
vi.mock("./v2/ContextAttachments", () => ({ ContextAttachments: () => null }));
vi.mock("@session/features/thread-workflows/PlanSidePanel", () => ({
  PlanSidePanel: () => null,
}));
vi.mock("@session/hooks/useFollowups", () => ({
  useFollowups: () => ({ state: { items: [], paused: false } }),
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
  followupService: { submit: io.submit },
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { loadThreadHistory: io.loadHistory },
}));

function entry(model: string): ThreadModelEntry {
  return {
    model,
    modelProvider: "openai",
    reasoningEffort: "medium",
    providerModels: { openai: model },
    revision: 0,
    pending: false,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    autoReviewCapability: null,
    collaborationMode: "default",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCodexStore.setState({
    currentThreadId: "main",
    threads: [
      { id: "main", source: "vscode", parentThreadId: null },
      { id: "side", source: "vscode", parentThreadId: null },
    ] as any,
    events: { main: [], side: [] },
    inputFocusTrigger: 0,
  });
  useThreadModelStore.setState({
    threads: { main: entry("main-model"), side: entry("side-model") },
  });
  useConfigStore.setState({
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    collaborationMode: "default",
  });
  useSessionDraftStore.setState({ drafts: {} });
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "side"), "保留侧边草稿");
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "main"), "保留主草稿");
  useSideChatStore.setState({
    chat: { id: "side", parentId: "main", title: "侧边聊天", images: [] },
  });
});

function mount() {
  const view = render(
    <div className="session-mode">
      <SideChatPanel />
    </div>,
  );
  return {
    ...view,
    editor: screen.getByRole("textbox", { name: "侧边聊天输入" }),
    trigger: within(screen.getByRole("region", { name: "侧边聊天" })).getByRole(
      "button",
      { name: /^执行权限：/ },
    ),
    mainBefore: structuredClone(useThreadModelStore.getState().threads.main),
    defaultsBefore: getThreadModelSettings(null),
  };
}

async function openPermissions() {
  const side = screen.getByRole("region", { name: "侧边聊天" });
  fireEvent.keyDown(within(side).getByRole("button", { name: /^执行权限：/ }), {
    key: "ArrowDown",
  });
  return screen.findByRole("menu");
}

function expectIsolated(mainBefore: ThreadModelEntry) {
  expect(useThreadModelStore.getState().threads.main).toEqual(mainBefore);
  expect(useCodexStore.getState().currentThreadId).toBe("main");
  expect(io.submit).not.toHaveBeenCalled();
  expect(io.deleteThread).not.toHaveBeenCalled();
  expect(io.loadHistory).not.toHaveBeenCalled();
  const drafts = useSessionDraftStore.getState().drafts;
  expect(drafts[sessionDraftKey("codex", "main")].text).toBe("保留主草稿");
  expect(drafts[sessionDraftKey("codex", "side")].text).toBe("保留侧边草稿");
}

it("changes only the side thread's read-only permission and restores its own menu trigger", async () => {
  const { trigger, mainBefore, defaultsBefore } = mount();
  await openPermissions();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "只读" }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(getThreadModelSettings("side").sandbox).toBe("read-only");
  expect(getThreadModelSettings("side").approvalPolicy).toBe("untrusted");
  expectIsolated(mainBefore);
  expect(getThreadModelSettings(null)).toEqual(defaultsBefore);
  expect(useCodexStore.getState().inputFocusTrigger).toBe(0);
  expect(document.activeElement).toBe(trigger);
});

it("changes only the side thread's planning mode", async () => {
  const { mainBefore } = mount();
  await openPermissions();
  fireEvent.click(screen.getByRole("menuitem", { name: "计划模式" }));
  await waitFor(() =>
    expect(getThreadModelSettings("side").collaborationMode).toBe("plan"),
  );
  expectIsolated(mainBefore);
  expect(useCodexStore.getState().inputFocusTrigger).toBe(0);
});

it("does not send the side permission selection's focus request to the main composer", async () => {
  const { trigger } = mount();
  await openPermissions();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "只读" }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(document.activeElement).toBe(trigger);
  expect(useCodexStore.getState().inputFocusTrigger).toBe(0);
});

it("keeps cancellation inert and applies explicit full-access confirmation only to the side thread", async () => {
  const { mainBefore } = mount();
  const sideBefore = structuredClone(
    useThreadModelStore.getState().threads.side,
  );
  await openPermissions();
  fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问权限/ }));
  const first = await screen.findByRole("dialog", {
    name: "要开启完整访问权限吗？",
  });
  fireEvent.click(within(first).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(useThreadModelStore.getState().threads.side).toEqual(sideBefore);
  expectIsolated(mainBefore);
  await openPermissions();
  fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问权限/ }));
  const second = await screen.findByRole("dialog", {
    name: "要开启完整访问权限吗？",
  });
  fireEvent.click(
    within(second).getByRole("button", { name: "确认" }),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(getThreadModelSettings("side").sandbox).toBe("danger-full-access");
  expect(getThreadModelSettings("side").approvalPolicy).toBe("never");
  expectIsolated(mainBefore);
  expect(useCodexStore.getState().inputFocusTrigger).toBe(0);
});

it("keeps a closed side confirmation from applying to its former thread", async () => {
  const { mainBefore } = mount();
  const sideBefore = structuredClone(
    useThreadModelStore.getState().threads.side,
  );
  await openPermissions();
  fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问权限/ }));
  await screen.findByRole("dialog", { name: "要开启完整访问权限吗？" });
  act(() => useSideChatStore.setState({ chat: null }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(useThreadModelStore.getState().threads.side).toEqual(sideBefore);
  expectIsolated(mainBefore);
});

it("uses explicit null for a new draft's defaults even while another thread is selected", async () => {
  const mainBefore = structuredClone(
    useThreadModelStore.getState().threads.main,
  );
  render(<AccessModePopover compact threadId={null} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^执行权限：/ }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "只读" }));
  expect(getThreadModelSettings(null).sandbox).toBe("read-only");
  expect(getThreadModelSettings("main").sandbox).toBe("workspace-write");
  expectIsolated(mainBefore);
});
